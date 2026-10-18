import type { CSSProperties } from "react";

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

export const s = {
  grid: { display: "grid", gap: 12, alignItems: "start" },
  col: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)", minWidth: 0, ...ellipsis },
  status: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" },
  stats: { fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 8 },
  count: { fontSize: 12, color: "var(--text-secondary)" },
  error: { fontSize: 12, color: "var(--crit)", wordBreak: "break-word" },
  list: { display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  item: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  itemTitle: { fontSize: 13, color: "var(--text-primary)", ...ellipsis },
  itemLoc: { fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", ...ellipsis },
  muted: { fontSize: 12, color: "var(--text-muted)" },
} satisfies Record<string, CSSProperties>;
