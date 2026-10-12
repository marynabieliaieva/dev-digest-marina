import type { CSSProperties } from "react";

export const s = {
  cards: (wide: boolean) =>
    ({
      display: "grid",
      gridTemplateColumns: wide ? "1fr 1fr" : "1fr",
      gap: 24,
      alignItems: "start",
    }) satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
