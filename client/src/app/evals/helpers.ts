/* Pure helpers shared by the /evals route components. */

/** ISO timestamp → "YYYY-MM-DD HH:mm" (UTC, deterministic). */
export function fmtDateTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/** Newest first, by start time. */
export function newestFirst<T extends { started_at: string }>(batches: T[]): T[] {
  return [...batches].sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/** Metric series colours: recall, precision, citation. */
export const METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;
