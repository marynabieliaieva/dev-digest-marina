import { describe, it, expect } from "vitest";
import { parsePatch } from "./helpers";
import { partitionFindings, topSeverity, type DiffFinding } from "./findings";

const PATCH = ["@@ -1,2 +1,3 @@", " a", "+b", " c"].join("\n");

function finding(id: string, start_line: number, severity: DiffFinding["severity"] = "WARNING"): DiffFinding {
  return { id, file: "x.ts", start_line, end_line: start_line, severity, title: id };
}

describe("partitionFindings", () => {
  it("keys findings on added/context lines and sends the rest outside", () => {
    const lines = parsePatch(PATCH);
    const { byKey, outside } = partitionFindings(
      [finding("add", 2), finding("ctx", 3), finding("gone", 99)],
      lines,
    );
    expect(byKey.get("RIGHT:2")?.map((f) => f.id)).toEqual(["add"]);
    expect(byKey.get("RIGHT:3")?.map((f) => f.id)).toEqual(["ctx"]);
    expect(outside.map((f) => f.id)).toEqual(["gone"]);
  });

  it("puts every finding outside when there is no patch", () => {
    const { byKey, outside } = partitionFindings([finding("a", 1), finding("b", 2)], parsePatch(null));
    expect(byKey.size).toBe(0);
    expect(outside).toHaveLength(2);
  });
});

describe("topSeverity", () => {
  it("returns the highest severity, or null when empty", () => {
    expect(topSeverity([finding("a", 1, "SUGGESTION"), finding("b", 1, "CRITICAL")])).toBe("CRITICAL");
    expect(topSeverity([])).toBeNull();
  });
});
