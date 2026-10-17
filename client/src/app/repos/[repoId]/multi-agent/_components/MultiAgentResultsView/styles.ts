import type { CSSProperties } from "react";

export const s = {
  root: { padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16 },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 },
  titleBlock: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  h1: { fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: 0 },
  sub: { fontSize: 13, color: "var(--text-secondary)" },
  meta: { fontSize: 12, color: "var(--text-muted)" },
  actions: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 },
  switchGroup: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  },
  switchBtn: {
    padding: "6px 12px",
    fontSize: 12.5,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    textTransform: "none",
  },
  switchBtnOn: { background: "var(--bg-hover)", color: "var(--text-primary)", fontWeight: 600 },
  note: { fontSize: 12, color: "var(--warn)" },
} satisfies Record<string, CSSProperties>;
