import type { SmartDiff, SmartDiffRole } from '@devdigest/shared';
import { FALLBACK_ROLE, ROLE_ORDER, ROLE_RULES } from './constants.js';

/** Pure helpers — no Fastify / DB / container imports, so callers outside HTTP can reuse them. */

export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffFindingInput {
  file: string;
  startLine: number;
}

export interface SmartDiffReviewInput {
  id: string;
  agentId: string | null;
  kind: string;
  createdAt: Date;
  findings: SmartDiffFindingInput[];
}

/** First matching rule wins; `core` when nothing matches. */
export function classifyFile(path: string): SmartDiffRole {
  const p = path.replace(/\\/g, '/');
  for (const rule of ROLE_RULES) {
    if (rule.patterns.some((re) => re.test(p))) return rule.role;
  }
  return FALLBACK_ROLE;
}

/**
 * The newest `kind === 'review'` review per agent (`null` agent = one bucket).
 * Must stay in sync with the client's `selectLatestFindings`.
 */
export function selectLatestReviews<T extends Pick<SmartDiffReviewInput, 'agentId' | 'kind' | 'createdAt'>>(
  reviews: T[],
): T[] {
  const newest = new Map<string | null, T>();
  for (const r of reviews) {
    if (r.kind !== 'review') continue;
    const cur = newest.get(r.agentId);
    if (!cur || r.createdAt.getTime() > cur.createdAt.getTime()) newest.set(r.agentId, r);
  }
  return [...newest.values()];
}

export function buildSmartDiff(files: SmartDiffFileInput[], findings: SmartDiffFindingInput[]): SmartDiff {
  const linesByFile = new Map<string, Set<number>>();
  for (const f of findings) {
    const set = linesByFile.get(f.file) ?? new Set<number>();
    set.add(f.startLine);
    linesByFile.set(f.file, set);
  }

  const groups = ROLE_ORDER.map((role) => ({
    role,
    files: files
      .filter((f) => classifyFile(f.path) === role)
      .map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        finding_lines: [...(linesByFile.get(f.path) ?? [])].sort((a, b) => a - b),
      })),
  }));

  const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  return {
    groups,
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
