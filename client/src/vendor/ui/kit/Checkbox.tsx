import React from "react";
import { Icon } from "../icons";

/** REAL controlled checkbox (styled). */
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  label?: React.ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 14,
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        style={{
          width: 20,
          height: 20,
          borderRadius: 5,
          border: "2px solid " + (checked ? "var(--accent)" : "var(--text-secondary)"),
          background: checked ? "var(--accent)" : "var(--bg-elevated)",
          flexShrink: 0,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
          padding: 0,
        }}
      >
        {checked && <Icon.Check size={14} style={{ color: "#fff" }} />}
      </button>
      {label}
    </label>
  );
}
