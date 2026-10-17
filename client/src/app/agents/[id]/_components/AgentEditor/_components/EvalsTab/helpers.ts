import type { EvalCaseDto, EvalDashboard } from "@devdigest/shared";

/** Minimal translator shape (next-intl's `t` for the `eval` namespace). */
export type EvalT = (key: string, values?: Record<string, string | number>) => string;

export type CaseStatus = "pass" | "fail" | "error" | "never";

export function caseStatus(c: EvalCaseDto): CaseStatus {
  const r = c.last_result;
  if (!r) return "never";
  if (r.error) return "error";
  return r.pass ? "pass" : "fail";
}

/** One-line result under a case name (AC-20). */
export function resultText(c: EvalCaseDto, t: EvalT): string {
  const r = c.last_result;
  if (!r) return t("evalsTab.neverRun");
  if (r.error) return t("evalsTab.view.resultError", { error: r.error });
  const key = c.expectation.type === "must_find" ? "evalsTab.resultMustFind" : "evalsTab.resultMustNotFlag";
  return t(key, { file: c.expectation.file, start: c.expectation.start_line, matched: r.matched_count });
}

export function passingCount(cases: EvalCaseDto[]): number {
  return cases.filter((c) => caseStatus(c) === "pass").length;
}

/** Newest first. */
export function newestFirst(cases: EvalCaseDto[]): EvalCaseDto[] {
  return [...cases].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface TileData {
  recall: number | null;
  precision: number | null;
  citation: number | null;
  prevRecall: number | null;
  prevPrecision: number | null;
  prevCitation: number | null;
  sparkRecall: number[];
  sparkPrecision: number[];
  sparkCitation: number[];
}

const nums = (xs: Array<number | null>): number[] => xs.filter((x): x is number => x != null);

/** Latest vs previous `done` set batch (the dashboard trend is chronological). */
export function tileData(d: EvalDashboard | undefined): TileData {
  const trend = d?.trend ?? [];
  const prev = trend.length >= 2 ? trend[trend.length - 2]! : null;
  return {
    recall: d?.current?.recall ?? null,
    precision: d?.current?.precision ?? null,
    citation: d?.current?.citation_accuracy ?? null,
    prevRecall: prev?.recall ?? null,
    prevPrecision: prev?.precision ?? null,
    prevCitation: prev?.citation_accuracy ?? null,
    sparkRecall: nums(trend.map((p) => p.recall)),
    sparkPrecision: nums(trend.map((p) => p.precision)),
    sparkCitation: nums(trend.map((p) => p.citation_accuracy)),
  };
}

export interface CaseSource {
  prRef: string | null;
  title: string | null;
  rationale: string | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** Defensive read of the frozen `input_meta` (typed `unknown` on the wire). */
export function readSource(inputMeta: unknown): CaseSource {
  const meta = isObj(inputMeta) ? inputMeta : {};
  const pr = isObj(meta.pr) ? meta.pr : {};
  const finding = isObj(meta.finding) ? meta.finding : {};
  const repo = typeof pr.repo === "string" ? pr.repo : null;
  const number = typeof pr.number === "number" ? pr.number : null;
  return {
    prRef: repo && number != null ? `${repo}#${number}` : null,
    title: typeof finding.title === "string" ? finding.title : null,
    rationale: typeof finding.rationale === "string" ? finding.rationale : null,
  };
}
