import type { CSSProperties } from "react";

/** Co-located styles for ContextTab. */
export const s = {
  wrap: { padding: "24px 28px 40px", display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
  note: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  injected: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
} as const;
