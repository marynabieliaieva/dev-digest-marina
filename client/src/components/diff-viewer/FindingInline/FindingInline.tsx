/* FindingInline — a review finding shown under its code line. The body comes
   from the caller's render-prop; this wrapper only adds the collapse control
   (expanded → full card, collapsed → one-line title row). */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { DiffFinding } from "../findings";
import { fs, chevronFor } from "../styles";

export function FindingInline({
  finding,
  renderFinding,
}: {
  finding: DiffFinding;
  renderFinding: (f: DiffFinding) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div data-testid="diff-finding-inline" style={fs.inline}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Collapse finding" : "Expand finding"}
        onClick={() => setOpen((o) => !o)}
        style={fs.toggle}
      >
        <Icon.ChevronRight size={12} style={chevronFor(open)} />
        {!open && <span>{finding.title}</span>}
      </button>
      {open && renderFinding(finding)}
    </div>
  );
}
