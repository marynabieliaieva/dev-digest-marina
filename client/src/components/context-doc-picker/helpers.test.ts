import { describe, expect, it } from "vitest";
import type { ContextDoc } from "@devdigest/shared";
import { buildRows, effectiveTokens, filterRows, reorderAttached } from "./helpers";

const doc = (path: string, est_tokens = 100, size = 400): ContextDoc => ({
  path,
  type: "specs",
  size,
  est_tokens,
  updated_at: "2026-01-01T00:00:00Z",
  used_by_agents: 0,
  used_by: [],
});

describe("reorderAttached", () => {
  it("moves an item to a new index", () => {
    expect(reorderAttached(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("returns the same array for a no-op", () => {
    const paths = ["a", "b"];
    expect(reorderAttached(paths, 1, 1)).toBe(paths);
  });
});

describe("buildRows", () => {
  const docs = [doc("specs/z.md"), doc("specs/a.md"), doc("specs/m.md"), doc("docs/b.md")];

  it("puts attached first in persisted order, then inherited, then alphabetical rest", () => {
    const rows = buildRows(docs, ["specs/z.md", "specs/a.md"], [{ path: "docs/b.md", skill_name: "rubric" }]);
    expect(rows.map((r) => [r.path, r.state])).toEqual([
      ["specs/z.md", "attached"],
      ["specs/a.md", "attached"],
      ["docs/b.md", "inherited"],
      ["specs/m.md", "available"],
    ]);
    expect(rows[2]!.via).toBe("rubric");
  });

  it("marks attached paths absent from docs as missing with 0 tokens", () => {
    const rows = buildRows(docs, ["gone.md"]);
    expect(rows[0]).toMatchObject({ path: "gone.md", state: "missing", est_tokens: 0 });
  });

  it("flags docs over 64 KiB as too large", () => {
    const rows = buildRows([doc("big.md", 20000, 70 * 1024)], []);
    expect(rows[0]!.tooLarge).toBe(true);
  });
});

describe("filterRows / effectiveTokens", () => {
  const docs = [doc("specs/rate-limiting.md", 250), doc("specs/other.md", 50)];

  it("filters case-insensitively by path substring", () => {
    const rows = buildRows(docs, []);
    expect(filterRows(rows, "RATE").map((r) => r.path)).toEqual(["specs/rate-limiting.md"]);
  });

  it("sums attached and inherited tokens, de-duplicated by path", () => {
    const rows = buildRows(docs, ["specs/rate-limiting.md"], [
      { path: "specs/rate-limiting.md", skill_name: "x" },
      { path: "specs/other.md", skill_name: "y" },
    ]);
    expect(effectiveTokens(rows)).toBe(300);
  });
});
