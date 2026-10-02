import type { FindingRecord, PrFile, ReviewRecord, RunSummary } from "@devdigest/shared";
import type { DiffFinding } from "@/components/diff-viewer";

/**
 * Findings the Files-changed tab shows: reviews of kind "review", newest per
 * agent (null agent = one bucket), all their findings. Same rule as the
 * server's `selectLatestReviews` so `● N` and inline cards agree.
 */
export function selectLatestFindings(reviews: readonly ReviewRecord[]): FindingRecord[] {
  const newest = new Map<string, ReviewRecord>();
  for (const r of reviews) {
    if (r.kind !== "review") continue;
    const key = r.agent_id ?? "";
    const cur = newest.get(key);
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) newest.set(key, r);
  }
  return [...newest.values()].flatMap((r) => r.findings);
}

/** Group findings by file path, ordered by line. */
export function findingsByPath(findings: readonly FindingRecord[]): Map<string, DiffFinding[]> {
  const out = new Map<string, DiffFinding[]>();
  for (const f of findings) {
    if (f.severity !== "CRITICAL" && f.severity !== "WARNING" && f.severity !== "SUGGESTION") continue;
    const list = out.get(f.file) ?? [];
    list.push({
      id: f.id,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      severity: f.severity,
      title: f.title,
    });
    out.set(f.file, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.start_line - b.start_line);
  return out;
}

/**
 * Patch-bearing files for one smart-diff group, in server order. Unlisted PR
 * files (no group claims them) are appended to `core` so nothing is dropped.
 */
export function filesForGroup(
  role: string,
  groupFiles: readonly { path: string }[],
  filesByPath: ReadonlyMap<string, PrFile>,
  unlisted: readonly PrFile[],
): PrFile[] {
  const own = groupFiles.flatMap((f) => filesByPath.get(f.path) ?? []);
  return role === "core" ? [...own, ...unlisted] : own;
}

export type SeverityCounts = Record<DiffFinding["severity"], number>;

/** Findings per severity across the given file paths (a Smart Diff group's files). */
export function severityCounts(paths: readonly string[], byPath: ReadonlyMap<string, DiffFinding[]>): SeverityCounts {
  const out: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const p of paths) for (const f of byPath.get(p) ?? []) out[f.severity] += 1;
  return out;
}

export interface RunUsage {
  tokensIn: number;
  tokensOut: number;
  /** null when no included run reported a cost (unknown, never 0). */
  costUsd: number | null;
  runs: number;
}

/**
 * Tokens/cost of the latest review: the newest finished run per agent (same
 * "latest per agent" rule as selectLatestFindings). null when nothing finished.
 */
export function selectLatestRunUsage(runs: readonly RunSummary[]): RunUsage | null {
  const newest = new Map<string | null, RunSummary>();
  for (const r of runs) {
    if (r.status !== "done") continue;
    const cur = newest.get(r.agent_id);
    if (!cur || (r.ran_at ?? "") > (cur.ran_at ?? "")) newest.set(r.agent_id, r);
  }
  if (newest.size === 0) return null;
  let costUsd: number | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const r of newest.values()) {
    tokensIn += r.tokens_in ?? 0;
    tokensOut += r.tokens_out ?? 0;
    if (r.cost_usd != null) costUsd = (costUsd ?? 0) + r.cost_usd;
  }
  return { tokensIn, tokensOut, costUsd, runs: newest.size };
}
