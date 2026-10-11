import type { RiskSeverity } from "@devdigest/shared";

/** Deep link into the Files-changed tab. `file` is encoded; `line` is added only when given. */
export function buildDiffHref(repoId: string, number: number | string, file: string, line?: number): string {
  const base = `/repos/${repoId}/pulls/${number}?tab=diff&file=${encodeURIComponent(file)}`;
  return line !== undefined ? `${base}&line=${line}` : base;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Cost label value; callers must not render it for `null` ("not computed"). */
export function formatCost(costUsd: number): string {
  return costUsd.toFixed(4);
}

/** Existing severity tokens: high = critical, medium = warning, low = muted. */
export function severityColor(severity: RiskSeverity): string {
  if (severity === "high") return "var(--crit)";
  if (severity === "medium") return "var(--warn)";
  return "var(--text-muted)";
}
