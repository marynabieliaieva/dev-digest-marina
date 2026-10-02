import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  header: {
    position: "sticky",
    top: "var(--pr-header-height, 132px)", // below the sticky PrDetailHeader (z 5)
    zIndex: 4,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 4px",
    background: "var(--bg-primary)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  square: (color: string): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  label: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  desc: { fontSize: 12, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  findings: { display: "inline-flex", gap: 8, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  chip: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    color,
    fontWeight: 600,
  }),
  count: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
};
