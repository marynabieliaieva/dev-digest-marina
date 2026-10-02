/* Review-finding support for the DiffViewer. Pure helpers + the API shape the
   viewer needs. The viewer stays generic: the route injects how a finding is
   rendered (`renderFinding`), exactly like DiffCommentApi. */
import type React from "react";
import { keysForLine } from "./comments";
import type { Line } from "./helpers";

export type DiffFindingSeverity = "CRITICAL" | "WARNING" | "SUGGESTION";

/** Structural subset of FindingRecord — a FindingRecord is assignable to it. */
export interface DiffFinding {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: DiffFindingSeverity;
  title: string;
}

export interface DiffFindingApi {
  byPath: ReadonlyMap<string, DiffFinding[]>; // key = PrFile.path
  show: boolean; // false → no inline cards / stripes / labels
  renderFinding: (f: DiffFinding) => React.ReactNode; // caller looks the full record up by f.id
}

const SEVERITY_RANK: Record<DiffFindingSeverity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

/** The most severe severity among the findings, or null when empty. */
/** Per-severity counts for a file's findings, worst first; severities with none are omitted. */
export function countBySeverity(
  findings: readonly DiffFinding[],
): { severity: DiffFindingSeverity; count: number }[] {
  const counts = new Map<DiffFindingSeverity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  return [...counts.entries()]
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

export function topSeverity(findings: readonly DiffFinding[]): DiffFindingSeverity | null {
  let best: DiffFindingSeverity | null = null;
  for (const f of findings) {
    if (best === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) best = f.severity;
  }
  return best;
}

/**
 * Split a file's findings into those anchored to a rendered line (keyed
 * `RIGHT:<start_line>`) and "outside" ones whose line isn't in the patch (or
 * whose patch is missing). Nothing is dropped.
 */
export function partitionFindings(
  findings: readonly DiffFinding[],
  parsedLines: readonly Line[],
): { byKey: Map<string, DiffFinding[]>; outside: DiffFinding[] } {
  const rightKeys = new Set<string>();
  for (const ln of parsedLines) {
    for (const k of keysForLine(ln)) if (k.startsWith("RIGHT:")) rightKeys.add(k);
  }
  const byKey = new Map<string, DiffFinding[]>();
  const outside: DiffFinding[] = [];
  for (const f of findings) {
    const key = `RIGHT:${f.start_line}`;
    if (rightKeys.has(key)) {
      const list = byKey.get(key) ?? [];
      list.push(f);
      byKey.set(key, list);
    } else {
      outside.push(f);
    }
  }
  return { byKey, outside };
}
