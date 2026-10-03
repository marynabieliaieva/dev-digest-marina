import type { CSSProperties } from "react";

export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  bodyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  } satisfies CSSProperties,
  tokenCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerNote: { flex: 1, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
  loading: { padding: 24, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
