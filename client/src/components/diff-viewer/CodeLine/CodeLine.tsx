/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, review findings under the
   line, and an inline composer. */
"use client";

import React from "react";
import { SEV } from "@devdigest/ui";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { topSeverity, type DiffFinding, type DiffFindingApi } from "../findings";
import { type Line } from "../helpers";
import { s, fs, lineRowFor, lineSignFor, findingStripe } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { FindingInline } from "../FindingInline";
import { InlineComposer } from "../InlineComposer";

const NO_FINDINGS: DiffFinding[] = [];

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  lineFindings = NO_FINDINGS,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  /** Findings anchored to this line (already partitioned by the file card). */
  lineFindings?: DiffFinding[];
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const shownFindings = findings?.show ? lineFindings : NO_FINDINGS;
  const severity = topSeverity(shownFindings);
  const accent = severity ? SEV[severity].c : null;
  const rowStyle = accent ? { ...lineRowFor(ln.kind), ...findingStripe(accent) } : lineRowFor(ln.kind);

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={rowStyle} data-finding-severity={severity ?? undefined}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
      </div>

      {findings &&
        shownFindings.map((f) => (
          <FindingInline key={f.id} finding={f} renderFinding={findings.renderFinding} />
        ))}

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
