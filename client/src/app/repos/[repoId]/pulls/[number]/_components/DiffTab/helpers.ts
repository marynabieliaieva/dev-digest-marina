import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
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
