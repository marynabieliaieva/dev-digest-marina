import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { selectLatestFindings, findingsByPath } from "./helpers";

function finding(id: string, file = "src/a.ts", line = 1): FindingRecord {
  return {
    id,
    severity: "WARNING",
    category: "bug",
    title: `t-${id}`,
    file,
    start_line: line,
    end_line: line,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r",
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

function review(
  id: string,
  agent: string | null,
  at: string,
  findings: FindingRecord[],
  kind: "review" | "summary" = "review",
): ReviewRecord {
  return {
    id,
    pr_id: "pr",
    agent_id: agent,
    run_id: null,
    kind,
    verdict: null,
    summary: null,
    score: null,
    model: null,
    created_at: at,
    findings,
  } as ReviewRecord;
}

describe("selectLatestFindings", () => {
  it("keeps only the newest review per agent, all agents, and ignores summaries", () => {
    const reviews = [
      review("r1", "a1", "2026-01-01T00:00:00Z", [finding("old")]),
      review("r2", "a1", "2026-01-03T00:00:00Z", [finding("new")]),
      review("r3", "a2", "2026-01-02T00:00:00Z", [finding("other")]),
      review("r4", "a3", "2026-01-04T00:00:00Z", [finding("sum")], "summary"),
    ];
    expect(selectLatestFindings(reviews).map((f) => f.id).sort()).toEqual(["new", "other"]);
  });

  it("treats a null agent as one bucket", () => {
    const reviews = [
      review("r1", null, "2026-01-01T00:00:00Z", [finding("old")]),
      review("r2", null, "2026-01-02T00:00:00Z", [finding("new")]),
    ];
    expect(selectLatestFindings(reviews).map((f) => f.id)).toEqual(["new"]);
  });
});

describe("findingsByPath", () => {
  it("groups by file and orders by start_line", () => {
    const map = findingsByPath([finding("b", "x.ts", 9), finding("a", "x.ts", 2), finding("c", "y.ts", 1)]);
    expect(map.get("x.ts")!.map((f) => f.id)).toEqual(["a", "b"]);
    expect(map.get("y.ts")!.map((f) => f.id)).toEqual(["c"]);
  });
});
