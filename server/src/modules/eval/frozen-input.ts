import type { EvalExpectation } from '@devdigest/shared';
import { CASE_NAME_MAX, MAX_DIFF_SECTION_CHARS } from './constants.js';
import { normalizePath } from './scoring.js';

/** Pure builders for an eval case's frozen input. No DB, no git. */

export type EvalDecision = 'accepted' | 'dismissed';

const HEADER = /^diff --git a\/(.+) b\/(.+)$/;

/**
 * The `diff --git` section for one file (header, ---/+++ and all hunks), or
 * `null` when the file is absent or its section has no `@@` hunk.
 */
export function sliceFileSection(rawDiff: string, path: string): string | null {
  const want = normalizePath(path);
  const starts: number[] = [];
  const re = /^diff --git /gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawDiff)) !== null) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]! : rawDiff.length;
    const section = rawDiff.slice(start, end);
    const headerLine = section.split('\n', 1)[0]!.replace(/\r$/, '');
    const h = HEADER.exec(headerLine);
    if (!h || (normalizePath(h[1]!) !== want && normalizePath(h[2]!) !== want)) continue;
    return /^@@ /m.test(section) ? section : null;
  }
  return null;
}

/** `'diff_too_large'` when the section exceeds the cap, else `null`. */
export function checkSectionSize(section: string): 'diff_too_large' | null {
  return section.length > MAX_DIFF_SECTION_CHARS ? 'diff_too_large' : null;
}

export function buildCaseName(type: EvalExpectation['type'], title: string): string {
  const prefix = type === 'must_find' ? 'Must find: ' : 'Must not flag: ';
  return (prefix + title).slice(0, CASE_NAME_MAX);
}

export interface FindingLike {
  id: string;
  reviewId: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: string;
  category: string;
  kind: string;
  title: string;
  rationale: string;
  suggestion: string | null;
  confidence: number;
}

export function buildExpectation(finding: FindingLike, decision: EvalDecision): EvalExpectation {
  return {
    type: decision === 'accepted' ? 'must_find' : 'must_not_flag',
    file: finding.file,
    start_line: finding.startLine,
    end_line: finding.endLine,
    kind: finding.kind as EvalExpectation['kind'],
    severity: finding.severity,
    category: finding.category,
    title: finding.title,
    source_finding_id: finding.id,
  };
}

export function buildInputMeta(
  pull: { number: number; title: string; body: string | null; base: string; headSha: string },
  repo: { fullName: string },
  review: { id: string; runId: string | null },
  finding: FindingLike,
  decision: EvalDecision,
  decidedAt: Date | string,
) {
  return {
    pr: {
      repo: repo.fullName,
      number: pull.number,
      title: pull.title,
      body: pull.body,
      base: pull.base,
      head_sha: pull.headSha,
    },
    finding: {
      id: finding.id,
      review_id: review.id,
      run_id: review.runId,
      severity: finding.severity,
      category: finding.category,
      kind: finding.kind,
      title: finding.title,
      rationale: finding.rationale,
      suggestion: finding.suggestion,
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      confidence: finding.confidence,
      decision,
      decided_at: decidedAt instanceof Date ? decidedAt.toISOString() : decidedAt,
    },
  };
}
