import type { CSSProperties } from "react";

export const s = {
  bar: { display: "flex", alignItems: "center", gap: 12, margin: "8px 0" } satisfies CSSProperties,
  heading: { fontSize: 11, letterSpacing: 0.6, fontWeight: 600, color: "var(--text-muted)" } satisfies CSSProperties,
  stat: { fontSize: 12, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  segmented: { display: "inline-flex", gap: 4 } satisfies CSSProperties,
  usage: { fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" } satisfies CSSProperties,
  noReview: { fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
};
