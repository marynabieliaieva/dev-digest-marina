import type { CSSProperties } from "react";

export function chevronStyle(open: boolean): CSSProperties {
  return { transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" };
}
