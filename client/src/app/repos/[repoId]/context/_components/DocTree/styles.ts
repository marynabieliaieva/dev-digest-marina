import type { CSSProperties } from "react";

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

export const s: {
  folder: CSSProperties;
  item: (active: boolean) => CSSProperties;
  name: CSSProperties;
} = {
  folder: {
    ...ellipsis,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-tertiary)",
    padding: "10px 12px 4px",
  },
  item: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 12px",
    borderRadius: 6,
    fontSize: 13,
    textAlign: "left",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    background: active ? "var(--bg-hover)" : "transparent",
  }),
  name: ellipsis,
};
