import type { CSSProperties } from "react";

export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  meta: { margin: 0, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  heading: {
    margin: "6px 0 0",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  diff: {
    margin: 0,
    padding: 12,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  line: { display: "flex", gap: 8, padding: "1px 6px" } satisfies CSSProperties,
  add: { background: "rgba(16, 185, 129, 0.16)" } satisfies CSSProperties,
  del: { background: "rgba(239, 68, 68, 0.16)" } satisfies CSSProperties,
  marker: { width: 12, flexShrink: 0, fontWeight: 700 } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
};
