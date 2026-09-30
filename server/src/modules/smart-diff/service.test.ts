import { describe, it, expect } from 'vitest';
import { SmartDiffResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { SmartDiffService } from './service.js';
import { ROLE_ORDER } from './constants.js';
import type { SmartDiffRepository, SmartDiffReviewInput } from './repository.js';

const FILES = [
  { path: 'server/src/a.ts', additions: 10, deletions: 2 },
  { path: 'server/pnpm-lock.yaml', additions: 100, deletions: 50 },
  { path: 'server/src/a.test.ts', additions: 5, deletions: 0 },
];

function review(
  id: string,
  agentId: string | null,
  t: number,
  lines: number[],
  file = 'server/src/a.ts',
  kind: 'review' | 'summary' = 'review',
): SmartDiffReviewInput {
  return {
    id,
    agentId,
    kind,
    createdAt: new Date(t),
    findings: lines.map((startLine) => ({ file, startLine })),
  };
}

function svc(reviews: SmartDiffReviewInput[], pullExists = true) {
  const repo: SmartDiffRepository = {
    pullExists: async () => pullExists,
    listFiles: async () => FILES,
    listReviews: async () => reviews,
  } as unknown as SmartDiffRepository;
  return new SmartDiffService(repo);
}

const fileOf = (d: { groups: { files: { path: string; finding_lines: number[] }[] }[] }, p: string) =>
  d.groups.flatMap((g) => g.files).find((f) => f.path === p)!;

describe('SmartDiffService.getSmartDiff', () => {
  it('(a) zero reviews: 5 groups in order, no finding lines, empty roles have no files', async () => {
    const d = await svc([]).getSmartDiff('w', 'p');
    expect(d.groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);
    for (const f of d.groups.flatMap((g) => g.files)) expect(f.finding_lines).toEqual([]);
    expect(d.groups.find((g) => g.role === 'docs')!.files).toEqual([]);
    expect(d.groups.find((g) => g.role === 'core')!.files.map((f) => f.path)).toEqual(['server/src/a.ts']);
    expect(d.groups.find((g) => g.role === 'boilerplate')!.files).toHaveLength(1);
  });

  it('(b) same agent: only newest review counts; two agents: both newest count', async () => {
    const same = await svc([review('old', 'a', 1, [1, 2]), review('new', 'a', 2, [7])]).getSmartDiff('w', 'p');
    expect(fileOf(same, 'server/src/a.ts').finding_lines).toEqual([7]);

    const two = await svc([
      review('a-old', 'a', 1, [1]),
      review('a-new', 'a', 3, [7]),
      review('b-new', 'b', 2, [4]),
    ]).getSmartDiff('w', 'p');
    expect(fileOf(two, 'server/src/a.ts').finding_lines).toEqual([4, 7]);
  });

  it('ignores summary reviews and findings for files not in the PR', async () => {
    const d = await svc([
      review('s', 'a', 5, [9], 'server/src/a.ts', 'summary'),
      review('r', 'b', 1, [3], 'elsewhere.ts'),
    ]).getSmartDiff('w', 'p');
    expect(fileOf(d, 'server/src/a.ts').finding_lines).toEqual([]);
  });

  it('(c) finding_lines are sorted and unique', async () => {
    const d = await svc([review('r', 'a', 1, [30, 5, 30, 12, 5])]).getSmartDiff('w', 'p');
    expect(fileOf(d, 'server/src/a.ts').finding_lines).toEqual([5, 12, 30]);
  });

  it('(d) total_lines sums additions+deletions; no split suggestion', async () => {
    const d = await svc([]).getSmartDiff('w', 'p');
    expect(d.split_suggestion).toEqual({ too_big: false, total_lines: 167, proposed_splits: [] });
  });

  it('(e) output passes SmartDiffResponse.parse', async () => {
    const d = await svc([review('r', 'a', 1, [3])]).getSmartDiff('w', 'p');
    expect(() => SmartDiffResponse.parse(d)).not.toThrow();
  });

  it('(f) unknown PR throws NotFoundError', async () => {
    await expect(svc([], false).getSmartDiff('w', 'p')).rejects.toBeInstanceOf(NotFoundError);
  });
});
