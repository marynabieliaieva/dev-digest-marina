/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { partitionFindings, topSeverity, type DiffFinding, type DiffFindingApi } from "../findings";
import { s, fs, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { OutsideFindings } from "../OutsideFindings";

const NO_FINDINGS: DiffFinding[] = [];

/** Findings anchored to a parsed line (RIGHT side only). */
function findingsForLine(ln: Line, byKey: Map<string, DiffFinding[]>): DiffFinding[] {
  if (byKey.size === 0 || ln.newNo == null || ln.kind === "del" || ln.kind === "hunk") return NO_FINDINGS;
  return byKey.get(`RIGHT:${ln.newNo}`) ?? NO_FINDINGS;
}

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findings,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const fileFindings = findings?.byPath.get(file.path) ?? NO_FINDINGS;
  const { byKey: findingsByKey, outside: outsideFindings } = React.useMemo(
    () => partitionFindings(fileFindings, lines),
    [fileFindings, lines],
  );
  const dotSeverity = topSeverity(fileFindings);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {dotSeverity && (
          <span
            data-testid="file-finding-dot"
            role="img"
            aria-label="Has review findings"
            style={{ ...fs.dot, background: SEV[dotSeverity].c }}
          />
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={`${ln.kind}:${ln.oldNo ?? "-"}:${ln.newNo ?? "-"}:${i}`}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={findings}
                lineFindings={findingsForLine(ln, findingsByKey)}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {findings?.show && (
            <OutsideFindings findings={outsideFindings} renderFinding={findings.renderFinding} />
          )}
        </div>
      )}
    </div>
  );
}
