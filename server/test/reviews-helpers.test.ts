import { describe, it, expect } from 'vitest';
import { filterReviewableDiff, taskLine } from '../src/modules/reviews/helpers.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

describe('filterReviewableDiff', () => {
  const sec = (p: string) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n+x`;
  const file = (path: string) => ({ path, additions: 1, deletions: 0, hunks: [] });
  const mk = (paths: string[]) => ({ raw: paths.map(sec).join('\n'), files: paths.map(file) });

  it('drops boilerplate and docs files from files and raw, keeps code and tests', () => {
    const { diff, skipped } = filterReviewableDiff(
      mk(['src/a.ts', 'pnpm-lock.yaml', 'docs/guide.md', 'src/a.test.ts']),
    );
    expect(skipped.sort()).toEqual(['docs/guide.md', 'pnpm-lock.yaml']);
    expect(diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/a.test.ts']);
    expect(diff.raw).toContain('a/src/a.ts b/src/a.ts');
    expect(diff.raw).not.toContain('pnpm-lock.yaml');
    expect(diff.raw).not.toContain('docs/guide.md');
  });

  it('returns the diff untouched when nothing is skippable', () => {
    const input = mk(['src/a.ts']);
    expect(filterReviewableDiff(input)).toEqual({ diff: input, skipped: [] });
  });

  it('never filters down to an empty diff', () => {
    const input = mk(['pnpm-lock.yaml', 'README.md']);
    expect(filterReviewableDiff(input)).toEqual({ diff: input, skipped: [] });
  });
});
