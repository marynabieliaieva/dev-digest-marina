import type { CSSProperties } from "react";

export const s = {
  page: { padding: "28px 40px", maxWidth: 1200 } satisfies CSSProperties,
  back: { fontSize: 13, color: "var(--text-secondary)", display: "inline-block", marginBottom: 14 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    marginBottom: 18,
    fontSize: 14,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 8,
  } satisfies CSSProperties,
  card: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
  } satisfies CSSProperties,
  xLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "var(--text-muted)",
    paddingLeft: 28,
  } satisfies CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: { padding: "10px 14px", fontSize: 13, borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
};
