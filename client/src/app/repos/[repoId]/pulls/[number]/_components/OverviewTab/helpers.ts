import React from "react";
import type { ReviewRecord, Verdict } from "@devdigest/shared";

export interface LatestVerdict {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName: string | null;
}

/** Latest `kind === 'review'` with a verdict (reviews arrive newest first), or null. */
export function selectLatestVerdictReview(reviews: ReviewRecord[] | undefined): LatestVerdict | null {
  const review = (reviews ?? []).find((r) => r.kind === "review" && r.verdict != null);
  if (!review || review.verdict == null) return null;
  return {
    verdict: review.verdict,
    summary: review.summary,
    score: review.score,
    findingsCount: review.findings.length,
    // Same expression as ReviewRunAccordion.tsx:58 (inlined there, not exported).
    blockers: review.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length,
    agentName: review.agent_name ?? null,
  };
}

/** SSR-safe media-query hook: `false` until mounted, then tracks `change` events. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
