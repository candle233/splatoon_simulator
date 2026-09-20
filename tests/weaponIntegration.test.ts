/**
 * Weapon integration guard.
 *
 * Adding a weapon to WEAPON_CONFIGS must not leave it half-wired: the roster is
 * shared by the lobby grid, the in-match hotkeys, the client's in-hand models,
 * the HUD icons and the server's simulation. These tests fail if a weapon is
 * reachable but renders nothing or can never fire.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEAPON_CONFIGS, isChargeWeapon } from '@ink/shared';
import type { WeaponType } from '@ink/shared';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const ALL_WEAPONS = Object.keys(WEAPON_CONFIGS) as WeaponType[];

describe('weapon roster is complete', () => {
  it('has the expected breadth', () => {
    expect(ALL_WEAPONS.length).toBeGreaterThanOrEqual(8);
  });

  it('every weapon has complete trilingual text and sane numbers', () => {
    for (const id of ALL_WEAPONS) {
      const cfg = WEAPON_CONFIGS[id];
      expect(cfg.id, `${id}.id mismatch`).toBe(id);
      for (const field of ['name', 'nameZh', 'nameJa', 'description', 'descriptionZh', 'descriptionJa'] as const) {
        expect(cfg[field]?.trim().length, `${id}.${field} is empty`).toBeGreaterThan(0);
      }
      expect(cfg.damage, `${id}.damage`).toBeGreaterThan(0);
      expect(cfg.inkCost, `${id}.inkCost`).toBeGreaterThan(0);
      expect(cfg.range, `${id}.range`).toBeGreaterThan(0);
      expect(cfg.fireRate, `${id}.fireRate`).toBeGreaterThan(0);
      expect(cfg.paintRadius, `${id}.paintRadius`).toBeGreaterThan(0);
      expect(Number.isFinite(cfg.spread), `${id}.spread`).toBe(true);
      expect(Number.isFinite(cfg.chargeTime ?? 0), `${id}.chargeTime`).toBe(true);
    }
  });
});

describe('every weapon renders a model', () => {
  it('PlayerView maps every weapon id to a real model group', () => {
    // Regression: setWeaponType() used to compare `type` against the four model
    // names directly with no fallback, so the four newer weapons hid EVERY group
    // and the fighter rendered empty-handed.
    const src = read('client/src/player/PlayerView.ts');

    const tableMatch = src.match(
      /const WEAPON_MODEL_GROUP: Record<WeaponType,[^>]*> = \{([\s\S]*?)\n\};/
    );
    expect(tableMatch, 'WEAPON_MODEL_GROUP table is missing').toBeTruthy();

    const body = tableMatch![1];
    const mapped = new Map<string, string>();
    const re = /(\w+):\s*'(\w+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) mapped.set(m[1], m[2]);

    const validGroups = new Set(['shooter', 'roller', 'charger', 'slosher']);
    for (const id of ALL_WEAPONS) {
      const group = mapped.get(id);
      expect(group, `${id} has no model group mapping`).toBeTruthy();
      expect(validGroups.has(group!), `${id} maps to unknown group "${group}"`).toBe(true);
    }

    // setWeaponType must actually consult the table rather than raw equality.
    expect(src).toMatch(/WEAPON_MODEL_GROUP\[type\]/);
  });

  it('the in-hand pose and laser follow the mapped group, not the raw id', () => {
    const src = read('client/src/player/PlayerView.ts');
    // The arm-pose switch, the roller roll and the charger laser must all use
    // the archetype, otherwise new weapons fall through to a default pose.
    const poseUsesTable = /switch \(WEAPON_MODEL_GROUP\[this\.currentWeapon\]/.test(src);
    const rollUsesTable = /WEAPON_MODEL_GROUP\[this\.currentWeapon\] === 'roller'/.test(src);
    const laserUsesTable = /WEAPON_MODEL_GROUP\[this\.currentWeapon\] === 'charger'/.test(src);
    expect(poseUsesTable, 'arm pose switch ignores the model group table').toBe(true);
    expect(rollUsesTable, 'roller roll ignores the model group table').toBe(true);
    expect(laserUsesTable, 'charger laser ignores the model group table').toBe(true);
  });
});

describe('every weapon is reachable and fireable', () => {
  it('the lobby grid is generated from WEAPON_CONFIGS, not hardcoded markup', () => {
    const src = read('client/src/ui/LobbyScreen.ts');
    expect(src, 'lobby grid must iterate WEAPON_CONFIGS').toMatch(
      /Object\.keys\(WEAPON_CONFIGS\)/
    );
  });

  it('the in-match hotkeys are derived from the roster', () => {
    // Regression: the digit bindings were a hardcoded 1-4 map, so the newer
    // weapons could not be selected mid-match at all.
    const src = read('client/src/core/Game.ts');
    expect(src, 'weapon hotkeys must be derived from WEAPON_CONFIGS').toMatch(
      /Object\.keys\(WEAPON_CONFIGS\)[\s\S]{0,120}Digit/
    );
  });

  it('the HUD has an icon for every weapon', () => {
    const src = read('client/src/ui/HUD.ts');
    const missing = ALL_WEAPONS.filter((id) => !new RegExp(`\\b${id}:\\s*'`).test(src));
    expect(missing, `HUD is missing icons for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the server simulates every weapon', () => {
    const src = read('server/src/WeaponSimulation.ts');
    // Each weapon either has an explicit fire path or is covered by the shared
    // hitscan fallback. Assert the dispatcher consults the config rather than a
    // frozen list, and that the explicitly-handled ids are real.
    for (const id of ['roller', 'charger', 'slosher', 'cannon', 'scatter'] as const) {
      expect(WEAPON_CONFIGS[id], `${id} handled by the server but not in config`).toBeTruthy();
      expect(src.includes(`'${id}'`), `server never references ${id}`).toBe(true);
    }
    expect(src, 'server must fall back to config, not a hardcoded weapon').toMatch(
      /WEAPON_CONFIGS\[weaponType\] \|\| WEAPON_CONFIGS\.shooter/
    );
  });

  it('the client charge gate is derived from weapon stats', () => {
    const src = read('client/src/core/Game.ts');
    // A charging weapon must be recognised from its config, so a new charge
    // weapon needs no client edit.
    expect(src, 'charge gate must use isChargeWeapon').toMatch(/isChargeWeapon\(/);
  });
});

describe('isChargeWeapon', () => {
  it('is true only for weapons with a charge time', () => {
    for (const id of ALL_WEAPONS) {
      const expected = (WEAPON_CONFIGS[id].chargeTime ?? 0) > 0;
      expect(isChargeWeapon(id), `${id} charge classification`).toBe(expected);
    }
    // The sniper charges; the marksman is explicitly a no-charge rifle.
    expect(isChargeWeapon('charger')).toBe(true);
    expect(isChargeWeapon('marksman')).toBe(false);
  });
});
