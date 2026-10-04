import type { BlastRadius } from "@devdigest/shared";

export type BlastNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface BlastNode {
  id: string;
  kind: BlastNodeKind;
  label: string;
  x: number;
  y: number;
}

export interface BlastGraphLayout {
  nodes: BlastNode[];
  edges: { from: string; to: string }[];
  width: number;
  height: number;
}

export const GRAPH_COL_X = [16, 280, 560] as const;
export const GRAPH_NODE_WIDTH = 220;
const ROW_HEIGHT = 30;
const PAD_Y = 16;

export interface BlastStats {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** The four headline numbers; endpoints/crons are unique across all groups. */
export function computeStats(blast: BlastRadius): BlastStats {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of blast.downstream) {
    callers += d.callers.length;
    d.endpoints_affected.forEach((e) => endpoints.add(e));
    d.crons_affected.forEach((c) => crons.add(c));
  }
  return { symbols: blast.changed_symbols.length, callers, endpoints: endpoints.size, crons: crons.size };
}

/**
 * Deterministic 3-column layout: symbol -> caller -> endpoint/cron.
 * Endpoints/crons are not attributed per caller by the API, so every caller of
 * a symbol links to each endpoint/cron the symbol affects.
 */
export function layoutBlastGraph(blast: BlastRadius): BlastGraphLayout {
  const nodes: BlastNode[] = [];
  const edges: { from: string; to: string }[] = [];
  const sinkRow = new Map<string, number>();
  let callerRow = 0;

  const addSink = (kind: "endpoint" | "cron", label: string): string => {
    const id = `${kind}:${label}`;
    if (!sinkRow.has(id)) {
      const row = sinkRow.size;
      sinkRow.set(id, row);
      nodes.push({ id, kind, label, x: GRAPH_COL_X[2], y: PAD_Y + row * ROW_HEIGHT });
    }
    return id;
  };

  blast.downstream.forEach((d, di) => {
    if (d.callers.length === 0) return;
    const symbolId = `symbol:${di}:${d.symbol}`;
    const firstRow = callerRow;
    const sinks = [
      ...d.endpoints_affected.map((e) => addSink("endpoint", e)),
      ...d.crons_affected.map((c) => addSink("cron", c)),
    ];
    d.callers.forEach((c, ci) => {
      const id = `caller:${di}:${ci}:${c.file}:${c.line}`;
      nodes.push({
        id,
        kind: "caller",
        label: `${c.name} (${c.file}:${c.line})`,
        x: GRAPH_COL_X[1],
        y: PAD_Y + callerRow * ROW_HEIGHT,
      });
      edges.push({ from: symbolId, to: id });
      sinks.forEach((sink) => edges.push({ from: id, to: sink }));
      callerRow += 1;
    });
    nodes.push({
      id: symbolId,
      kind: "symbol",
      label: d.symbol,
      x: GRAPH_COL_X[0],
      y: PAD_Y + ((firstRow + callerRow - 1) / 2) * ROW_HEIGHT,
    });
  });

  const rows = Math.max(callerRow, sinkRow.size);
  return {
    nodes,
    edges,
    width: GRAPH_COL_X[2] + GRAPH_NODE_WIDTH + GRAPH_COL_X[0],
    height: nodes.length === 0 ? 0 : PAD_Y * 2 + rows * ROW_HEIGHT,
  };
}

/** Shorten long labels for the SVG, which cannot wrap text. */
export function truncateLabel(label: string, max = 34): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
