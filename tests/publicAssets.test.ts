/**
 * Every static /assets/... path the client renders must exist on disk.
 * Dynamic weapon/sub/special filenames are expanded from the shared configs.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_DEFS, SPECIAL_CONFIGS, SUB_WEAPON_CONFIGS } from '@ink/shared';

const ROOT = join(__dirname, '..');
const CLIENT = join(ROOT, 'client');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...walk(full));
    } else if (/\.(ts|css|html)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function quotedAssetPaths(source: string): string[] {
  const found: string[] = [];
  const re = /['"`(](\/assets\/[^'"`)\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    found.push(match[1]!);
  }
  return found;
}

describe('public asset files', () => {
  it('resolves every referenced image under client/public', () => {
    const paths = new Set<string>();
    for (const file of walk(CLIENT)) {
      for (const assetPath of quotedAssetPaths(readFileSync(file, 'utf8'))) {
        if (assetPath.includes('${')) continue;
        paths.add(assetPath);
      }
    }
    for (const id of Object.keys(SUB_WEAPON_CONFIGS)) {
      paths.add(`/assets/weapons/${id}.jpg`);
    }
    for (const id of Object.keys(SPECIAL_CONFIGS)) {
      paths.add(`/assets/weapons/${id}.jpg`);
    }
    for (const id of Object.keys(MAP_DEFS)) {
      paths.add(`/assets/maps/${id}.jpg`);
    }

    const missing = [...paths].filter((assetPath) => {
      const disk = join(CLIENT, 'public', assetPath.replace(/^\//, ''));
      return !existsSync(disk);
    });
    expect(missing, `missing public files:\n${missing.join('\n')}`).toEqual([]);
  });
});
