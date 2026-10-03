import type { CSSProperties } from "react";
import { CARD_GRID_COLS } from "./constants";

export const s = {
  page: { minWidth: 0, padding: "24px 32px 44px" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  dropped: { fontSize: 12.5, color: "var(--warn)", marginTop: 4 } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
    paddingBottom: 14,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  toolbarCount: { fontSize: 13, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  grid: { display: "grid", gridTemplateColumns: CARD_GRID_COLS, gap: 14, maxWidth: "50%" } satisfies CSSProperties,
} as const;
