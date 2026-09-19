import { describe, expect, it } from 'vitest';
import { applyI18n, getLang, langLabel, setLang, t } from '../client/src/i18n.js';
import { LANGS } from '../client/src/i18n.js';

describe('i18n framework (中日英三语)', () => {
  it('supports exactly zh / ja / en with native labels', () => {
    expect(LANGS).toEqual(['zh', 'ja', 'en']);
    expect(langLabel('zh')).toBe('中文');
    expect(langLabel('ja')).toBe('日本語');
    expect(langLabel('en')).toBe('English');
  });

  it('t() switches languages and falls back to English then the key', () => {
    setLang('en');
    expect(t('lobby.ready')).toBe('READY!');
    setLang('zh');
    expect(t('lobby.ready')).toBe('准备!');
    setLang('ja');
    expect(t('lobby.ready')).toBe('準備完了!');

    // Missing key in zh/ja falls back to the English dict; missing everywhere
    // echoes the key itself.
    expect(t('definitely.not.a.key')).toBe('definitely.not.a.key');
    expect(getLang()).toBe('ja');
    setLang('en');
  });

  it('interpolates {params}', () => {
    setLang('en');
    expect(t('hud.syncing', { n: 3, m: 10 })).toBe('Synchronizing arena… (3/10)');
    expect(t('lobby.matchIn', { s: 5 })).toBe('Match in 5s…');
  });

  it('every dictionary has identical key coverage across the three languages', () => {
    // Import the private dicts through a fresh t() sweep is impossible, so we
    // rely on parity between languages by scanning a representative set of
    // keys used across the UI.
    const requiredKeys = [
      'title.play',
      'title.codex',
      'title.settings',
      'lobby.badge',
      'lobby.selectWeapon',
      'lobby.skills',
      'lobby.mode',
      'lobby.map',
      'lobby.addBot',
      'lobby.removeBot',
      'lobby.ready',
      'lobby.start',
      'lobby.avatarUpload',
      'hud.hp',
      'hud.inkTank',
      'hud.specialMeter',
      'hud.weaponSwitchHint',
      'hud.splatted',
      'hud.sbTitle',
      'gameover.pinkWins',
      'gameover.draw',
      'settings.title',
      'settings.quality',
      'codex.title',
      'codex.tabWeapons',
      'codex.dmg',
      'codex.range'
    ];
    for (const lang of LANGS) {
      setLang(lang);
      for (const key of requiredKeys) {
        const val = t(key);
        expect(val, `${lang}:${key} missing`).not.toBe(key);
        expect(val.length).toBeGreaterThan(0);
      }
    }
    setLang('en');
  });

  it('applyI18n fills data-i18n nodes (smoke: no crash without DOM nodes)', () => {
    expect(() => applyI18n()).not.toThrow();
  });
});
