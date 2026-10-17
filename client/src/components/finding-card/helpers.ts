import type { FindingRecord } from "@devdigest/shared";

/** `ApiError.code`s the eval-case endpoint can return (AC-16); each has copy under
 *  `prReview.finding.evalCase.errors.<code>`. Anything else falls back to `generic`. */
export const EVAL_CASE_ERROR_CODES = [
  "already_eval_case",
  "finding_undecided",
  "agent_missing",
  "file_not_in_diff",
  "diff_too_large",
] as const;

export type EvalCaseErrorKey = (typeof EVAL_CASE_ERROR_CODES)[number] | "generic";

/** Map an unknown thrown value to a copy key under `finding.evalCase.errors`. */
export function evalCaseErrorKey(err: unknown): EvalCaseErrorKey {
  const code = (err as { code?: unknown } | null)?.code;
  return (EVAL_CASE_ERROR_CODES as readonly unknown[]).includes(code)
    ? (code as EvalCaseErrorKey)
    : "generic";
}

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
