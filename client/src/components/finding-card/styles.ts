import type { CSSProperties } from "react";

/** Co-located styles for FindingCard (extracted from inline styles). */
export const s = {
  /** Dims a decided finding's text; the action buttons stay at full strength. */
  dim: (muted: boolean): CSSProperties => ({ opacity: muted ? 0.85 : 1, transition: "opacity .2s" }),
  card: (focused: boolean, sevColor: string): CSSProperties => ({
    borderRadius: 8,
    // All-longhand (never mix `border` shorthand with `borderLeft` — React warns
    // about updating shorthand + non-shorthand on the same rerender).
    borderStyle: "solid",
    borderColor: focused ? sevColor : "var(--border)",
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: sevColor,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    transition: "border-color .12s, box-shadow .12s",
    boxShadow: focused ? "0 0 0 1px " + sevColor : "none",
  }),
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 16px",
    cursor: "pointer",
  } satisfies CSSProperties,
  badgeWrap: { paddingTop: 1, filter: "brightness(1.3)" } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (muted: boolean, dismissed: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  acceptedTag: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  dismissedTag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
  } satisfies CSSProperties,
  chevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(180deg)" : "none",
    transition: "transform .15s",
    marginTop: 2,
    flexShrink: 0,
  }),
  body: { padding: "14px 16px 16px", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  trifectaWrap: { marginBottom: 14 } satisfies CSSProperties,
  prose: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  suggestionWrap: { marginTop: 14 } satisfies CSSProperties,
  suggestionLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-secondary)",
    marginBottom: 8,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  /** Action buttons: tinted so they read as clickable, not as disabled chrome. */
  acceptBtn: {
    color: "var(--ok)",
    borderColor: "var(--ok)",
    fontWeight: 600,
  } satisfies CSSProperties,
  dismissBtn: {
    color: "var(--crit)",
    borderColor: "var(--crit)",
    fontWeight: 600,
  } satisfies CSSProperties,
  evalBtn: {
    // Lightened accent (dark-theme accent is low-contrast on the card); the opacity
    // override keeps it readable even while disabled ("In eval set").
    color: "color-mix(in srgb, var(--accent) 55%, var(--text-primary))",
    borderColor: "color-mix(in srgb, var(--accent) 70%, var(--text-primary))",
    fontWeight: 600,
    opacity: 0.95,
  } satisfies CSSProperties,
  /** Visually hidden text referenced by `aria-describedby`. */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  composer: {
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  composerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
