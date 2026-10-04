/* OutsideFindings — footer list for findings whose line isn't in this file's
   patch (or whose patch is missing), so none is silently dropped. */
"use client";

import React from "react";
import type { DiffFinding } from "../findings";
import { fs } from "../styles";

export function OutsideFindings({
  findings,
  renderFinding,
}: {
  findings: DiffFinding[];
  renderFinding: (f: DiffFinding) => React.ReactNode;
}) {
  if (findings.length === 0) return null;
  return (
    <div data-testid="diff-findings-outside" style={fs.outsideWrap}>
      <span style={fs.outsideTitle}>Findings outside the diff ({findings.length})</span>
      {findings.map((f) => (
        <React.Fragment key={f.id}>{renderFinding(f)}</React.Fragment>
      ))}
    </div>
  );
}
