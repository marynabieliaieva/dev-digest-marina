import type { EvalExpectation } from '@devdigest/shared';
import { FULL_FILE_KINDS } from './constants.js';

/**
 * Pure eval scoring. No LLM, no DB — it only reads the grounded/dropped findings
 * a run already produced. Metrics are fractions 0..1; `null` = not computed.
 */

export interface ScorableFinding {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  kind?: string | null;
}

export interface CaseScore {
  /** null when the agent call errored. */
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  matched_finding_ids: string[];
  matched_count: number;
  /** Grounded findings produced. */
  actual_count: number;
  dropped_count: number;
}

export interface BatchCaseInput {
  type: EvalExpectation['type'];
  errored: boolean;
  pass: boolean | null;
  matched_count: number;
  actual_count: number;
  dropped_count: number;
  cost_usd: number | null;
}

export interface BatchScore {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  traces_passed: number;
  traces_total: number;
  cost_usd: number | null;
}

/** Strip a leading `./` or `/` and turn `\` into `/`. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '');
}

function isFullFileKind(kind: string | null | undefined): boolean {
  return !!kind && FULL_FILE_KINDS.includes(kind);
}

/** Does an actual finding match the expectation (spec "Match")? */
export function matches(
  finding: Pick<ScorableFinding, 'file' | 'start_line' | 'end_line' | 'kind'>,
  expectation: Pick<EvalExpectation, 'file' | 'start_line' | 'end_line' | 'kind'>,
): boolean {
  if (normalizePath(finding.file) !== normalizePath(expectation.file)) return false;
  if (isFullFileKind(expectation.kind) || isFullFileKind(finding.kind)) return true;
  const fs = Math.min(finding.start_line, finding.end_line);
  const fe = Math.max(finding.start_line, finding.end_line);
  const es = Math.min(expectation.start_line, expectation.end_line);
  const ee = Math.max(expectation.start_line, expectation.end_line);
  return fs <= ee && es <= fe;
}

export function scoreCase(input: {
  expectation: EvalExpectation;
  grounded: ScorableFinding[];
  dropped: readonly unknown[];
  errored?: boolean;
}): CaseScore {
  const { expectation, grounded, dropped } = input;
  if (input.errored) {
    return {
      pass: null,
      recall: null,
      precision: null,
      citation_accuracy: null,
      matched_finding_ids: [],
      matched_count: 0,
      actual_count: 0,
      dropped_count: 0,
    };
  }
  const matched = grounded.filter((f) => matches(f, expectation));
  const matchedCount = matched.length;
  const mustFind = expectation.type === 'must_find';
  const total = grounded.length + dropped.length;
  return {
    pass: mustFind ? matchedCount >= 1 : matchedCount === 0,
    recall: mustFind ? (matchedCount >= 1 ? 1 : 0) : null,
    precision: mustFind ? null : grounded.length === 0 ? 1 : 1 - matchedCount / grounded.length,
    citation_accuracy: total === 0 ? null : grounded.length / total,
    matched_finding_ids: matched.map((f) => f.id),
    matched_count: matchedCount,
    actual_count: grounded.length,
    dropped_count: dropped.length,
  };
}

export function scoreBatch(cases: BatchCaseInput[]): BatchScore {
  const scored = cases.filter((c) => !c.errored);

  const mustFind = scored.filter((c) => c.type === 'must_find');
  const recall = mustFind.length === 0 ? null : mustFind.filter((c) => c.pass === true).length / mustFind.length;

  const mustNot = scored.filter((c) => c.type === 'must_not_flag');
  let precision: number | null = null;
  if (mustNot.length > 0) {
    const produced = mustNot.reduce((n, c) => n + c.actual_count, 0);
    const matched = mustNot.reduce((n, c) => n + c.matched_count, 0);
    precision = produced === 0 ? 1 : 1 - matched / produced;
  }

  const grounded = scored.reduce((n, c) => n + c.actual_count, 0);
  const dropped = scored.reduce((n, c) => n + c.dropped_count, 0);
  const citation_accuracy = grounded + dropped === 0 ? null : grounded / (grounded + dropped);

  const costs = cases.map((c) => c.cost_usd);
  const cost_usd =
    costs.length === 0 || costs.some((c) => c === null)
      ? null
      : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);

  return {
    recall,
    precision,
    citation_accuracy,
    traces_passed: cases.filter((c) => c.pass === true).length,
    traces_total: cases.length,
    cost_usd,
  };
}
