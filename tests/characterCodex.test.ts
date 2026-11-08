/**
 * Codex characters: Coral Chanter & Volt Skimmer.
 *
 * Guards the two latest CHARACTER_TAB entries: each is present exactly once
 * (located by its img path), sits before the squid_morph entry so the
 * championship key art still closes the tab, its artwork exists on disk, and
 * its badge key resolves in all three language dictionaries.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODEX_TABS } from '../client/src/ui/CodexData.js';
import { DICTIONARIES, LANGS } from '../client/src/i18n.js';
import type { Lang } from '../client/src/i18n.js';

const ROOT = join(__dirname, '..');

const NEW_CHARACTERS = [
  {
    img: '/assets/characters/coral_chanter.jpg',
    badgeKey: 'codex.badgeCoral',
    badgeClass: 'coral',
    title: { zh: '珊瑚礁歌姬', ja: 'サンゴの歌い手', en: 'Coral Chanter' }
  },
  {
    img: '/assets/characters/volt_skimmer.jpg',
    badgeKey: 'codex.badgeVolt',
    badgeClass: 'volt',
    title: { zh: '雷紫疾冲手', ja: 'ボルト・スキマー', en: 'Volt Skimmer' }
  }
] as const;

const characters = CODEX_TABS.find((tab) => tab.id === 'characters');
if (!characters) throw new Error('characters tab missing from CODEX_TABS');

describe('character codex: coral chanter & volt skimmer', () => {
  it('contains exactly one entry per new character, located by img path', () => {
    for (const character of NEW_CHARACTERS) {
      const matches = characters.items.filter((item) => item.img === character.img);
      expect(matches, character.img).toHaveLength(1);
    }
  });

  it('sits before the squid_morph entry, key art still last', () => {
    const imgs = characters.items.map((item) => item.img);
    const morphIdx = imgs.indexOf('/assets/characters/squid_morph.jpg');
    const keyArtIdx = imgs.indexOf('/assets/characters/inkling_duel_clash.jpg');
    for (const character of NEW_CHARACTERS) {
      expect(imgs.indexOf(character.img), `${character.img} position`).toBeGreaterThanOrEqual(0);
      expect(imgs.indexOf(character.img), `${character.img} must precede squid_morph`).toBeLessThan(morphIdx);
    }
    expect(keyArtIdx, 'championship key art must stay last').toBe(imgs.length - 1);
  });

  it('entries carry the expected badge key/class, title and three tags', () => {
    for (const character of NEW_CHARACTERS) {
      const entry = characters.items.find((item) => item.img === character.img)!;
      expect(entry.badgeKey).toBe(character.badgeKey);
      expect(entry.badgeClass).toBe(character.badgeClass);
      expect(entry.title).toEqual(character.title);
      expect(entry.tags).toHaveLength(3);
      for (const lang of ['zh', 'ja', 'en'] as const) {
        expect(entry.desc[lang].trim(), `${character.img} desc.${lang}`).not.toBe('');
      }
      // The ask caps the zh description at one 40–80 字 paragraph.
      expect(entry.desc.zh.length, `${character.img} desc.zh length`).toBeGreaterThanOrEqual(40);
      expect(entry.desc.zh.length, `${character.img} desc.zh length`).toBeLessThanOrEqual(80);
    }
  });

  it('both artwork files are real illustrations, not swatches or duplicates', () => {
    const charDir = join(ROOT, 'client', 'public', 'assets', 'characters');
    for (const character of NEW_CHARACTERS) {
      const disk = join(ROOT, 'client', 'public', character.img.replace(/^\//, ''));
      expect(existsSync(disk), character.img).toBe(true);
      const bytes = readFileSync(disk);
      // A real portrait in this asset family is ≥ ~100 KB (existing art is
      // 0.9-1.2 MB); a flat colour-swatch placeholder compresses to ~15 KB.
      expect(bytes.length, `${character.img} is suspiciously small`).toBeGreaterThanOrEqual(100 * 1024);
    }
    // The new art must not be a byte-copy of any other character artwork.
    const others = readdirSync(charDir)
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => createHash('sha256').update(readFileSync(join(charDir, f))).digest('hex'));
    const newHashes = NEW_CHARACTERS.map((c) =>
      createHash('sha256').update(readFileSync(join(ROOT, 'client', 'public', c.img.replace(/^\//, '')))).digest('hex'));
    for (const hash of newHashes) {
      expect(others.filter((h) => h === hash), 'artwork duplicated inside characters/').toHaveLength(1);
    }
  });

  it('badge keys are defined in all three dictionaries', () => {
    for (const character of NEW_CHARACTERS) {
      for (const lang of LANGS) {
        const value = (DICTIONARIES[lang] as Record<string, string>)[character.badgeKey];
        expect(value, `${lang}:${character.badgeKey} missing`).toBeTruthy();
      }
    }
  });
});
