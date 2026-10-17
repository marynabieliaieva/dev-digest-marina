import { describe, expect, it } from 'vitest';
import {
  buildCaseName,
  buildExpectation,
  buildInputMeta,
  checkSectionSize,
  sliceFileSection,
  type FindingLike,
} from './frozen-input.js';

const sec = (path: string, body: string) =>
  `diff --git a/${path} b/${path}\nindex 111..222 100644\n--- a/${path}\n+++ b/${path}\n${body}`;

const A = sec('src/a.ts', '@@ -1,1 +1,1 @@\n-a1\n+a2\n');
const B = sec('src/b.ts', '@@ -1,1 +1,1 @@\n-b1\n+b2\n@@ -10,1 +10,1 @@\n-b3\n+b4\n');
const C = sec('src/c.ts', '@@ -1,1 +1,1 @@\n-c1\n+c2\n');
const RAW = A + B + C;

describe('sliceFileSection', () => {
  it('returns only the middle file, with both hunks', () => {
    const out = sliceFileSection(RAW, 'src/b.ts');
    expect(out).toBe(B);
    expect(out).not.toContain('a1');
    expect(out).not.toContain('c1');
    expect(out!.match(/^@@ /gm)).toHaveLength(2);
  });
  it('returns null for an absent file', () => {
    expect(sliceFileSection(RAW, 'src/zzz.ts')).toBeNull();
  });
  it('returns null for a header-only section', () => {
    const raw = A + 'diff --git a/bin.png b/bin.png\nBinary files differ\n';
    expect(sliceFileSection(raw, 'bin.png')).toBeNull();
  });
  it('normalises the requested path', () => {
    expect(sliceFileSection(RAW, './src/c.ts')).toBe(C);
  });
});

describe('checkSectionSize', () => {
  it('rejects a section above 200 000 chars', () => {
    expect(checkSectionSize('x'.repeat(200_001))).toBe('diff_too_large');
    expect(checkSectionSize('x'.repeat(200_000))).toBeNull();
  });
});

describe('buildCaseName', () => {
  it('prefixes by type', () => {
    expect(buildCaseName('must_find', 'T')).toBe('Must find: T');
    expect(buildCaseName('must_not_flag', 'T')).toBe('Must not flag: T');
  });
  it('truncates to 120 chars total, keeping the prefix', () => {
    const n = buildCaseName('must_find', 'x'.repeat(200));
    expect(n).toHaveLength(120);
    expect(n.startsWith('Must find: ')).toBe(true);
  });
});

const finding: FindingLike = {
  id: 'f1',
  reviewId: 'r1',
  file: 'src/a.ts',
  startLine: 3,
  endLine: 5,
  severity: 'WARNING',
  category: 'security',
  kind: 'finding',
  title: 'Title',
  rationale: 'why',
  suggestion: null,
  confidence: 0.8,
};

describe('buildExpectation', () => {
  it('maps accepted to must_find and dismissed to must_not_flag', () => {
    expect(buildExpectation(finding, 'accepted')).toMatchObject({ type: 'must_find', start_line: 3, source_finding_id: 'f1' });
    expect(buildExpectation(finding, 'dismissed').type).toBe('must_not_flag');
  });
});

describe('buildInputMeta', () => {
  it('has exactly the spec keys', () => {
    const meta = buildInputMeta(
      { number: 7, title: 'PR', body: null, base: 'main', headSha: 'abc' },
      { fullName: 'o/n' },
      { id: 'r1', runId: null },
      finding,
      'accepted',
      new Date('2026-10-15T00:00:00Z'),
    );
    expect(Object.keys(meta)).toEqual(['pr', 'finding']);
    expect(Object.keys(meta.pr)).toEqual(['repo', 'number', 'title', 'body', 'base', 'head_sha']);
    expect(Object.keys(meta.finding)).toEqual([
      'id', 'review_id', 'run_id', 'severity', 'category', 'kind', 'title', 'rationale', 'suggestion',
      'file', 'start_line', 'end_line', 'confidence', 'decision', 'decided_at',
    ]);
    expect(meta.finding.decided_at).toBe('2026-10-15T00:00:00.000Z');
  });
});
