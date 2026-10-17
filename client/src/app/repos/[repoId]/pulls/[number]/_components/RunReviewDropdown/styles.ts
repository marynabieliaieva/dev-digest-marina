import type { CSSProperties } from "react";

/** Co-located styles for RunReviewDropdown. Panel mirrors the @devdigest/ui
   Dropdown popover (absolute, right-aligned). */
export const s = {
  root: { position: "relative", display: "inline-block" },
  panel: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 10,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  heading: { fontSize: 12, fontWeight: 600, color: "var(--text-primary)" },
  muted: { fontSize: 12, color: "var(--text-secondary)" },
  row: { minWidth: 0 },
  rowBlocked: { opacity: 0.5, pointerEvents: "none" },
  rowLabel: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 },
  rowName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
  },
  rowHint: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 },
  actions: { display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 },
  configure: {
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 12,
    textAlign: "left",
    padding: 0,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;
