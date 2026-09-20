/**
 * Trilingual coverage guard.
 *
 * This is the regression net for client/src/i18n.ts: it fails the moment one
 * language drifts from the other two, or the moment a `data-i18n` attribute /
 * `t('...')` call in the client refers to a key that does not exist. Both
 * checks read the real files from disk, so they catch typos automatically
 * instead of relying on a hand-maintained list of "important" keys.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGS, allKeys, t } from '../client/src/i18n.js';
import type { Lang } from '../client/src/i18n.js';

const ROOT = join(__dirname, '..');
const CLIENT_SRC = join(ROOT, 'client', 'src');
const INDEX_HTML = join(ROOT, 'client', 'index.html');

const dict = (lang: Lang): Record<string, string> => DICTIONARIES[lang] as Record<string, string>;

/** Every .ts file under client/src, recursively. */
function clientTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...clientTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `t('some.key')` / `t("some.key")` literal in a source file. Template
 * literals and computed keys are intentionally not matched: they cannot be
 * validated statically and would produce false failures.
 */
function literalTKeys(source: string): string[] {
  const keys: string[] = [];
  const re = /\bt\(\s*(['"])([A-Za-z][A-Za-z0-9_.-]*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) keys.push(m[2]);
  return keys;
}

/** Every data-i18n / -placeholder / -title / -alt attribute value in the HTML. */
function htmlI18nKeys(html: string): string[] {
  const keys: string[] = [];
  const re = /data-i18n(?:-placeholder|-title|-alt)?="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) keys.push(m[1]);
  return keys;
}

describe('i18n coverage (zh / ja / en)', () => {
  it('all three dictionaries define exactly the same key set', () => {
    const reference = allKeys();
    expect(reference.length).toBeGreaterThan(0);
    for (const lang of LANGS) {
      const keys = Object.keys(dict(lang)).sort();
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      expect(missing, `${lang} is missing keys`).toEqual([]);
      expect(extra, `${lang} has keys no other language defines`).toEqual([]);
      expect(keys, `${lang} key set differs from the reference`).toEqual(reference);
    }
  });

  it('no dictionary value is empty or still equal to its key', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(dict(lang))) {
        expect(value.trim(), `${lang}:${key} is empty`).not.toBe('');
        expect(value, `${lang}:${key} still equals its key`).not.toBe(key);
      }
    }
  });

  it('t() resolves every key in every language without falling back to the key', () => {
    for (const lang of LANGS) {
      for (const key of allKeys()) {
        const value = t(key);
        expect(value, `${lang}:${key} did not resolve`).not.toBe(key);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('every data-i18n attribute in client/index.html resolves in all three languages', () => {
    const html = readFileSync(INDEX_HTML, 'utf8');
    const keys = [...new Set(htmlI18nKeys(html))];
    expect(keys.length, 'no data-i18n attributes found in index.html').toBeGreaterThan(20);
    for (const key of keys) {
      for (const lang of LANGS) {
        const value = dict(lang)[key];
        expect(value, `index.html uses "${key}" but ${lang} does not define it`).toBeDefined();
        expect(value?.trim()).not.toBe('');
      }
    }
  });

  it('every literal t() key in client/src/**/*.ts resolves in all three languages', () => {
    const files = clientTsFiles(CLIENT_SRC);
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    let checked = 0;
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      for (const key of literalTKeys(readFileSync(file, 'utf8'))) {
        checked++;
        for (const lang of LANGS) {
          if (!dict(lang)[key]) offenders.push(`${rel}: t('${key}') missing in ${lang}`);
        }
      }
    }

    expect(checked, 'no literal t() calls were scanned').toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('wires up the previously-unused keys (quality labels, radar, host-only, codex stats)', () => {
    // settings.q* are driven through QUALITY_LABEL_KEY; hud.radar by Minimap.
    const qualityKeys = ['settings.qLow', 'settings.qMed', 'settings.qHigh', 'settings.qAuto'];
    const srcAll = clientTsFiles(CLIENT_SRC)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const html = readFileSync(INDEX_HTML, 'utf8');

    for (const key of qualityKeys) {
      expect(srcAll.includes(key) || html.includes(key), `${key} is never referenced`).toBe(true);
    }
    expect(srcAll.includes("'hud.radar'"), 'hud.radar is never referenced').toBe(true);
    expect(srcAll.includes('QUALITY_LABEL_KEY'), 'QUALITY_LABEL_KEY is never used').toBe(true);
    // codex.charge / codex.roll / codex.rate are referenced by CodexData.
    for (const key of ['codex.charge', 'codex.roll', 'codex.rate']) {
      expect(srcAll.includes(key), `${key} is never referenced`).toBe(true);
    }
    // lobby.hostOnly is consumed by LobbyScreen (not owned here, but must resolve).
    expect(dict('en')['lobby.hostOnly']).toBeTruthy();
    for (const lang of LANGS) {
      expect(dict(lang)['lobby.hostOnly']?.trim()).not.toBe('');
    }
  });

  it('game terms stay consistent across languages (no third-party trademarks)', () => {
    // The project deliberately avoids third-party marks; these words must not
    // appear anywhere in the dictionaries.
    const banned = /splatoon|nintendo|splattershot|splat roller|inkling|octoling/i;
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(dict(lang))) {
        expect(banned.test(value), `${lang}:${key} contains a third-party term: ${value}`).toBe(false);
      }
    }
  });

  it('localizes the static markup at boot, not only on a language switch', () => {
    // Regression: applyI18n() used to run only inside setLang(), so every
    // element carrying data-i18n kept the English text the HTML shipped with
    // until the player manually switched language. initI18n() must exist and be
    // called from the bootstrap.
    const mainSrc = readFileSync(join(CLIENT_SRC, 'main.ts'), 'utf8');
    expect(mainSrc, 'main.ts must import initI18n').toMatch(/\binitI18n\b/);

    const i18nSrc = readFileSync(join(CLIENT_SRC, 'i18n.ts'), 'utf8');
    expect(i18nSrc, 'i18n.ts must export initI18n').toMatch(/export function initI18n\b/);
    // initI18n has to actually apply the translations and set <html lang>.
    const initBody = i18nSrc.slice(i18nSrc.indexOf('export function initI18n'));
    expect(initBody.slice(0, 200)).toMatch(/applyI18n\(\)/);
    expect(initBody.slice(0, 200)).toMatch(/syncDocumentLang\(\)/);
  });
});
