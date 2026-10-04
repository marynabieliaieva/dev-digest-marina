import { describe, it, expect } from "vitest";
import type { BlastRadius } from "@devdigest/shared";
import { computeStats, layoutBlastGraph } from "./helpers";

const blast: BlastRadius = {
  changed_symbols: [
    { name: "login", file: "src/auth.ts", kind: "function" },
    { name: "unused", file: "src/u.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "login",
      callers: [
        { name: "handler", file: "src/routes.ts", line: 10 },
        { name: "job", file: "src/cron.ts", line: 4 },
      ],
      endpoints_affected: ["POST /login"],
      crons_affected: ["nightly"],
    },
  ],
  summary: "",
};

describe("layoutBlastGraph", () => {
  it("lays out three columns with symbol->caller->sink edges, deterministically", () => {
    const g = layoutBlastGraph(blast);
    const xs = (kind: string) => new Set(g.nodes.filter((n) => n.kind === kind).map((n) => n.x));
    const symX = [...xs("symbol")];
    const callerX = [...xs("caller")];
    const sinkX = [...xs("endpoint"), ...xs("cron")];
    expect(symX).toHaveLength(1);
    expect(callerX).toHaveLength(1);
    expect(new Set(sinkX).size).toBe(1);
    expect(symX[0]!).toBeLessThan(callerX[0]!);
    expect(callerX[0]!).toBeLessThan(sinkX[0]!);

    const kind = (id: string) => g.nodes.find((n) => n.id === id)?.kind;
    const pairs = g.edges.map((e) => `${kind(e.from)}>${kind(e.to)}`);
    expect(pairs.filter((p) => p === "symbol>caller")).toHaveLength(2);
    expect(pairs).toContain("caller>endpoint");
    expect(pairs).toContain("caller>cron");

    expect(layoutBlastGraph(blast)).toEqual(g);
  });

  it("returns no nodes for empty input", () => {
    const g = layoutBlastGraph({ changed_symbols: [], downstream: [], summary: "" });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });
});

describe("computeStats", () => {
  it("counts symbols, callers and unique endpoints/crons", () => {
    expect(computeStats(blast)).toEqual({ symbols: 2, callers: 2, endpoints: 1, crons: 1 });
  });
});
