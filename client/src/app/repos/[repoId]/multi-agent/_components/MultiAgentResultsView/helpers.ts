/* Pure helpers for the multi-agent results view. */
import type { AgentColumn, FindingRecord, ReviewRecord } from "@devdigest/shared";
import { estimateSeconds } from "@/lib/multi-agent";

export type ResultsMode = "columns" | "tabs";

/** `?view=` → mode; anything but "tabs" is the default Columns mode. */
export function parseMode(raw: string | null): ResultsMode {
  return raw === "tabs" ? "tabs" : "columns";
}

/** "8.2" for the header meta line. */
export function metaSeconds(ms: number): string {
  return estimateSeconds(ms);
}

/** "8.2s" for a column / summary stat. */
export function durationLabel(ms: number | null): string | null {
  return ms == null ? null : `${estimateSeconds(ms)}s`;
}

/** The selected tab's column: `run` from the URL, else the first column. */
export function pickColumn(columns: AgentColumn[], runId: string | null): AgentColumn | null {
  return columns.find((c) => c.run_id === runId) ?? columns[0] ?? null;
}

/** The persisted review (kind = review) produced by a run, if any. */
export function reviewForRun(
  reviews: ReviewRecord[] | undefined,
  runId: string,
): ReviewRecord | undefined {
  return reviews?.find((r) => r.run_id === runId && r.kind === "review");
}

/** That run's persisted findings (empty until the review is fetched). */
export function findingsForRun(
  reviews: ReviewRecord[] | undefined,
  runId: string,
): FindingRecord[] {
  return reviewForRun(reviews, runId)?.findings ?? [];
}
