import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  applyBudget,
  docType,
  estTokens,
  globToRegExp,
  isSafeRelPath,
  matchesAny,
  mergeEffective,
  readDocConfined,
  walkDocs,
} from '../src/modules/project-context/helpers.js';
import { DEFAULT_CONTEXT_GLOBS } from '../src/modules/project-context/constants.js';
import { loadConfig } from '../src/platform/config.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pc-'));
  for (const f of [
    'specs/a.md',
    'docs/x/b.md',
    'insights/c.md',
    'src/readme.md',
    'specs/d.txt',
    'node_modules/x/specs/y.md',
  ]) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), `# ${f}\n`);
  }
  return root;
}

describe('globs', () => {
  it('default glob matches docs folders and rejects others', () => {
    for (const p of ['specs/a.md', 'docs/x/b.md', 'insights/c.md', 'pkg/docs/d.md']) {
      expect(matchesAny(p, DEFAULT_CONTEXT_GLOBS), p).toBe(true);
    }
    for (const p of ['src/readme.md', 'specs/d.txt']) {
      expect(matchesAny(p, DEFAULT_CONTEXT_GLOBS), p).toBe(false);
    }
  });
  it('custom adr glob', () => {
    const g = ['**/adr/**/*.md'];
    expect(matchesAny('docs/adr/0001.md', g)).toBe(true);
    expect(matchesAny('adr/0001.md', g)).toBe(true);
    expect(matchesAny('docs/other/0001.md', g)).toBe(false);
  });
  it('supports ? and escapes metacharacters', () => {
    expect(globToRegExp('a?.md').test('ab.md')).toBe(true);
    expect(globToRegExp('a?.md').test('a/.md')).toBe(false);
    expect(globToRegExp('a.md').test('aXmd')).toBe(false);
  });
});

describe('path rules and derivations', () => {
  it('isSafeRelPath', () => {
    for (const p of [
      '../../etc/passwd',
      '/etc/passwd',
      'src/a.ts',
      'specs/../src/a.md',
      'C:/a.md',
      'a\\b.md',
      'a//b.md',
      'a"b.md',
    ]) {
      expect(isSafeRelPath(p), p).toBe(false);
    }
    expect(isSafeRelPath('specs/a.md')).toBe(true);
    expect(isSafeRelPath('a/'.repeat(300) + 'x.md')).toBe(false);
  });
  it('docType and estTokens', () => {
    expect(docType('docs/specs/x.md')).toBe('docs');
    expect(docType('specs/x.md')).toBe('specs');
    expect(docType('insights/x.md')).toBe('insights');
    expect(docType('adr/x.md')).toBe('docs');
    expect(estTokens('a'.repeat(1000))).toBe(250);
  });
  it('mergeEffective: agent first, first occurrence wins', () => {
    const r = mergeEffective(
      ['a', 'b'],
      [
        { name: 's1', paths: ['b', 'c'] },
        { name: 's2', paths: ['a', 'd'] },
      ],
    );
    expect(r.map((e) => e.path)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.map((e) => e.origin)).toEqual(['agent', 'agent', 'skill', 'skill']);
    expect(r[2]!.skill_name).toBe('s1');
    expect(r[3]!.skill_name).toBe('s2');
  });
});

describe('applyBudget', () => {
  const doc = (path: string, tokens: number) => ({
    path,
    bytes: tokens * 4,
    content: 'a'.repeat(tokens * 4),
  });
  it('skips over-budget but continues', () => {
    const r = applyBudget([doc('a', 15_000), doc('b', 8_000), doc('c', 3_000)]);
    expect(r.map((d) => d.status)).toEqual(['included', 'over_budget', 'included']);
  });
  it('too_large, missing, unreadable', () => {
    const r = applyBudget([
      { path: 'big', bytes: 70_000, content: null },
      { path: 'gone', bytes: 0, content: null, readError: 'missing' as const },
      { path: 'bad', bytes: 0, content: null, readError: 'unreadable' as const },
    ]);
    expect(r.map((d) => d.status)).toEqual(['too_large', 'missing', 'unreadable']);
    expect(r[0]!.est_tokens).toBe(17_500);
    expect(r[1]!.est_tokens).toBe(0);
  });
});

describe('walkDocs / readDocConfined', () => {
  it('lists exactly the matching files', async () => {
    const root = fixture();
    const docs = await walkDocs(root, DEFAULT_CONTEXT_GLOBS);
    expect(docs.map((d) => d.path)).toEqual(['docs/x/b.md', 'insights/c.md', 'specs/a.md']);
  });
  it('excludes symlinks', async (ctx) => {
    const root = fixture();
    try {
      symlinkSync(join(root, 'specs/a.md'), join(root, 'specs/link.md'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw err;
    }
    const docs = await walkDocs(root, DEFAULT_CONTEXT_GLOBS);
    expect(docs.map((d) => d.path)).not.toContain('specs/link.md');
    expect((await readDocConfined(root, 'specs/link.md')).status).toBe('unreadable');
  });
  it('reads ok, missing, unreadable (bad utf-8), too_large, rejected', async () => {
    const root = fixture();
    expect((await readDocConfined(root, 'specs/a.md')).status).toBe('ok');
    expect((await readDocConfined(root, 'specs/nope.md')).status).toBe('missing');
    writeFileSync(join(root, 'specs/bad.md'), Buffer.from([0xff, 0xfe, 0xfd]));
    expect((await readDocConfined(root, 'specs/bad.md')).status).toBe('unreadable');
    writeFileSync(join(root, 'specs/big.md'), 'x'.repeat(70_000));
    expect((await readDocConfined(root, 'specs/big.md')).status).toBe('too_large');
    expect((await readDocConfined(root, '../x.md')).status).toBe('unreadable');
  });
});

describe('config', () => {
  it('PROJECT_CONTEXT_GLOBS', () => {
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(loadConfig(env({ PROJECT_CONTEXT_GLOBS: ' **/adr/**/*.md ,, ' })).projectContextGlobs).toEqual([
      '**/adr/**/*.md',
    ]);
    expect(
      loadConfig(
        env({ PROJECT_CONTEXT_GLOBS: '**/{specs,docs,insights}/**/*.md,**/adr/**/*.md' }),
      ).projectContextGlobs,
    ).toEqual(['**/{specs,docs,insights}/**/*.md', '**/adr/**/*.md']);
    expect(loadConfig(env({})).projectContextGlobs).toEqual(DEFAULT_CONTEXT_GLOBS);
    expect(loadConfig(env({ PROJECT_CONTEXT_GLOBS: '' })).projectContextGlobs).toEqual(
      DEFAULT_CONTEXT_GLOBS,
    );
  });
});
