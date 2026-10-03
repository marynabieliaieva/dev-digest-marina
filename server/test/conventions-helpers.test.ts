import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  groundConventions,
  mergeToSkillBody,
  numberLines,
  pickConfigFiles,
  readSourceSamples,
  type RawConventionCandidate,
} from '../src/modules/conventions/helpers.js';
import type { ConventionCandidate } from '@devdigest/shared';

/**
 * Pure/clone-local pieces of the conventions pipeline: line numbering, the
 * config allowlist reader, evidence grounding, and the skill-body renderer.
 * No DB — mirrors skills-helpers.test.ts.
 */

describe('numberLines', () => {
  it('prefixes each line with its 1-based number and truncates to maxLines', () => {
    expect(numberLines('a\nb\nc', 2)).toBe('1: a\n2: b');
  });
});

describe('pickConfigFiles', () => {
  function makeClone(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'conv-clone-'));
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(dir, rel), content, 'utf8');
    }
    return dir;
  }

  it('reads allowlisted config files with real line numbers', async () => {
    const dir = makeClone({
      'tsconfig.json': '{\n  "strict": true\n}',
      '.editorconfig': 'root = true',
      'not-in-allowlist.txt': 'ignored',
    });
    const { files } = await pickConfigFiles(dir, 300);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['.editorconfig', 'tsconfig.json']);
  });

  it('special-cases package.json into a scripts+deps digest, never a citable file', async () => {
    const dir = makeClone({
      'package.json': JSON.stringify({
        scripts: { build: 'tsc' },
        dependencies: { zod: '^3.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      }),
    });
    const { files, packageJsonDigest } = await pickConfigFiles(dir, 300);
    expect(files.find((f) => f.path === 'package.json')).toBeUndefined();
    expect(packageJsonDigest).toContain('"build"');
    expect(packageJsonDigest).toContain('zod');
    expect(packageJsonDigest).not.toContain('"version"'); // never the whole file
  });

  it('degrades to an empty digest for malformed JSON, never throws', async () => {
    const dir = makeClone({ 'package.json': '{ not json' });
    const { packageJsonDigest } = await pickConfigFiles(dir, 300);
    expect(packageJsonDigest).toBeNull();
  });

  it('a missing allowlisted file is simply absent, not an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-clone-'));
    const { files, packageJsonDigest } = await pickConfigFiles(dir, 300);
    expect(files).toEqual([]);
    expect(packageJsonDigest).toBeNull();
  });
});

describe('readSourceSamples', () => {
  const fakeTokenizer = { count: (text: string) => text.length };

  it('reads sampled paths off the clone, truncated to maxLines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-src-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n'));
    const samples = await readSourceSamples(dir, ['src/a.ts'], fakeTokenizer, 3, 10_000);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.lines).toEqual(['line0', 'line1', 'line2']);
  });

  it('stops adding files once the token budget is exceeded, but keeps at least one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-src-'));
    writeFileSync(join(dir, 'a.ts'), 'x'.repeat(50));
    writeFileSync(join(dir, 'b.ts'), 'y'.repeat(50));
    const samples = await readSourceSamples(dir, ['a.ts', 'b.ts'], fakeTokenizer, 300, 10);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.path).toBe('a.ts');
  });

  it('skips a path that does not exist in the clone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-src-'));
    const samples = await readSourceSamples(dir, ['missing.ts'], fakeTokenizer, 300, 10_000);
    expect(samples).toEqual([]);
  });
});

describe('groundConventions', () => {
  const sampled = new Map<string, string[]>([
    ['src/a.ts', ['export class FooService {', '  constructor() {}', '}']],
  ]);

  function candidate(over: Partial<RawConventionCandidate> = {}): RawConventionCandidate {
    return {
      category: 'naming',
      rule: 'Service classes are suffixed with Service.',
      evidence: { path: 'src/a.ts', line: 1, snippet: 'export class FooService' },
      confidence: 0.9,
      ...over,
    };
  }

  it('keeps a candidate whose snippet is verifiably at the cited line', () => {
    const { kept, droppedCount } = groundConventions([candidate()], sampled, []);
    expect(kept).toHaveLength(1);
    expect(droppedCount).toBe(0);
    expect(kept[0]).toMatchObject({ evidencePath: 'src/a.ts', evidenceLine: 1 });
  });

  it('drops a candidate citing a file outside the sampled set', () => {
    const { kept, droppedCount } = groundConventions(
      [candidate({ evidence: { path: 'src/missing.ts', line: 1, snippet: 'x' } })],
      sampled,
      [],
    );
    expect(kept).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it('drops a candidate whose line is out of range', () => {
    const { kept } = groundConventions(
      [candidate({ evidence: { path: 'src/a.ts', line: 99, snippet: 'export class FooService' } })],
      sampled,
      [],
    );
    expect(kept).toHaveLength(0);
  });

  it('drops a candidate whose snippet has drifted away from the cited line', () => {
    const { kept } = groundConventions(
      [candidate({ evidence: { path: 'src/a.ts', line: 1, snippet: 'this text is not in the file' } })],
      sampled,
      [],
    );
    expect(kept).toHaveLength(0);
  });

  it('drops a duplicate of a rule already kept in this batch', () => {
    const { kept, droppedCount } = groundConventions([candidate(), candidate()], sampled, []);
    expect(kept).toHaveLength(1);
    expect(droppedCount).toBe(1);
  });

  it('drops a rule that duplicates an existing enabled skill body', () => {
    const { kept } = groundConventions(
      [candidate()],
      sampled,
      ['Some preamble.\n\nService classes are suffixed with Service.\n'],
    );
    expect(kept).toHaveLength(0);
  });

  it('drops a candidate with out-of-range confidence', () => {
    const { kept } = groundConventions([candidate({ confidence: 1.5 })], sampled, []);
    expect(kept).toHaveLength(0);
  });

  it('drops an empty or oversized rule', () => {
    const empty = groundConventions([candidate({ rule: '   ' })], sampled, []);
    expect(empty.kept).toHaveLength(0);
    const oversized = groundConventions([candidate({ rule: 'x'.repeat(241) })], sampled, []);
    expect(oversized.kept).toHaveLength(0);
  });
});

describe('mergeToSkillBody', () => {
  it('renders one section per accepted convention under a directive header', () => {
    const accepted: ConventionCandidate[] = [
      {
        id: '1',
        category: 'naming',
        rule: 'Service classes are suffixed with Service.',
        evidence_path: 'src/a.ts',
        evidence_line: 1,
        evidence_snippet: 'export class FooService',
        confidence: 0.9,
        status: 'accepted',
        edited: false,
        skill_id: null,
      },
    ];
    const body = mergeToSkillBody(accepted);
    expect(body).toContain('Flag changes that violate any rule below');
    expect(body).toContain('## Naming: Service classes are suffixed with Service.');
    expect(body).toContain('Detected in `src/a.ts:1`');
    expect(body).toContain('export class FooService');
  });
});
