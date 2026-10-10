import type { CSSProperties } from "react";

/** Co-located styles for SkillContextTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 650 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  serializesLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  pre: {
    margin: 0,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    overflowX: "auto",
  } satisfies CSSProperties,
} as const;
