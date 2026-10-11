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
import { countBySeverity, partitionFindings, type DiffFinding, type DiffFindingApi } from "../findings";
import type { DiffExpandSignal } from "../expand";
import { s, fs, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { OutsideFindings } from "../OutsideFindings";

const NO_FINDINGS: DiffFinding[] = [];
/** How long the deep-link target stays highlighted. */
const DEEP_LINK_HIGHLIGHT_MS = 2000;

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
  expandSignal,
  focus = false,
  focusLine = null,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  expandSignal?: DiffExpandSignal;
  /** Deep-link target: open this card, scroll to it and highlight it briefly. */
  focus?: boolean;
  /** New-side line to land on inside the focused file (header when absent / not rendered). */
  focusLine?: number | null;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    focus || (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  // "Expand/collapse all" command from the parent (nonce 0 = none issued yet).
  React.useEffect(() => {
    if (expandSignal && expandSignal.nonce > 0) setOpen(expandSignal.open);
  }, [expandSignal]);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Deep link: force open, scroll once, highlight for DEEP_LINK_HIGHLIGHT_MS.
  const headerRef = React.useRef<HTMLDivElement>(null);
  const targetLineRef = React.useRef<HTMLDivElement>(null);
  const scrolledFor = React.useRef<string | null>(null);
  const [highlight, setHighlight] = React.useState(focus);
  const focusKey = focus ? `${file.path}:${focusLine ?? ""}` : null;
  const lineTargetIdx = React.useMemo(
    () =>
      focus && focusLine != null
        ? lines.findIndex((l) => l.kind !== "hunk" && l.kind !== "del" && l.newNo === focusLine)
        : -1,
    [focus, focusLine, lines],
  );
  React.useEffect(() => {
    if (!focusKey) {
      setHighlight(false);
      return;
    }
    setOpen(true);
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), DEEP_LINK_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [focusKey]);
  React.useEffect(() => {
    if (!focusKey || !open || scrolledFor.current === focusKey) return;
    scrolledFor.current = focusKey;
    (targetLineRef.current ?? headerRef.current)?.scrollIntoView?.({ block: "center" });
  }, [focusKey, open, lineTargetIdx]);
  const headerHighlighted = highlight && lineTargetIdx < 0;

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
  const severityChips = countBySeverity(fileFindings);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div
        ref={headerRef}
        onClick={() => setOpen((o) => !o)}
        style={headerHighlighted ? { ...s.fileHeader, outline: "2px solid var(--accent)", outlineOffset: -2 } : s.fileHeader}
        data-deeplink-target={headerHighlighted ? "true" : undefined}
      >
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
        {severityChips.length > 0 && (
          <span data-testid="file-finding-dot" role="img" aria-label="Has review findings" style={fs.badges}>
            {severityChips.map(({ severity, count }) => {
              const I = Icon[SEV[severity].icon];
              return (
                <span
                  key={severity}
                  data-severity={severity}
                  title={`${count} ${SEV[severity].label.toLowerCase()}${count === 1 ? "" : "s"}`}
                  style={{ ...fs.badge, color: SEV[severity].c }}
                >
                  <I size={12} />
                  {count}
                </span>
              );
            })}
          </span>
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
                deepLinkRef={i === lineTargetIdx ? targetLineRef : undefined}
                deepLinkActive={i === lineTargetIdx && highlight}
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
