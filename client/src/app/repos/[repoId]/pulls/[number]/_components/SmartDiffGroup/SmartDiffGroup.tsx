/* SmartDiffGroup — one role group on Files changed: sticky header (chevron,
   role, description, per-severity `● N` finding chips, file count) + the group's files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi, type DiffExpandSignal, type DiffFindingApi } from "@/components/diff-viewer";
import { COLLAPSED_BY_DEFAULT, ROLE_COLOR, ROLE_DESC_KEY, ROLE_LABEL_KEY, SEVERITY_CHIPS } from "./constants";
import { s } from "./styles";
import { chevronStyle } from "./helpers";

export function SmartDiffGroup({
  role,
  files,
  severityCounts,
  hasReview,
  commenting,
  findings,
}: {
  role: SmartDiffRole;
  /** Files of the group, in server order, with their patches. */
  files: PrFile[];
  /** Findings in this group's files, per severity (drives the coloured header chips). */
  severityCounts: Record<"CRITICAL" | "WARNING" | "SUGGESTION", number>;
  hasReview: boolean;
  commenting: DiffCommentApi;
  findings: DiffFindingApi;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(!COLLAPSED_BY_DEFAULT.has(role));
  const label = t(`smartDiff.${ROLE_LABEL_KEY[role]}`);
  // This header's own "expand/collapse all files" command (nonce 0 = none issued yet).
  const [signal, setSignal] = React.useState<DiffExpandSignal>({ open: true, nonce: 0 });
  const [filesOpen, setFilesOpen] = React.useState(true);
  const toggleFiles = () => {
    const next = !filesOpen;
    setFilesOpen(next);
    setOpen(true);
    setSignal((p) => ({ open: next, nonce: p.nonce + 1 }));
  };

  return (
    <div data-testid={`smart-diff-group-${role}`} style={s.wrap}>
      <div style={s.header}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((o) => !o)}
          style={s.toggle}
        >
          <Icon.ChevronRight size={14} style={chevronStyle(open)} />
        </button>
        <span style={s.square(ROLE_COLOR[role])} />
        <span style={s.label}>{label}</span>
        <span style={s.desc}>{t(`smartDiff.${ROLE_DESC_KEY[role]}`)}</span>
        {hasReview && (
          <span data-testid="smart-diff-group-findings" style={s.findings}>
            {SEVERITY_CHIPS.filter((c) => severityCounts[c.severity] > 0).map((c) => {
              const I = Icon[SEV[c.severity].icon];
              const n = severityCounts[c.severity];
              return (
                <span
                  key={c.severity}
                  data-testid={`smart-diff-group-sev-${c.severity}`}
                  title={`${n} ${c.word}${n === 1 ? "" : "s"}`}
                  style={s.chip(SEV[c.severity].c)}
                >
                  <I size={12} />
                  {n}
                </span>
              );
            })}
            {SEVERITY_CHIPS.every((c) => severityCounts[c.severity] === 0) && <span>● 0</span>}
          </span>
        )}
        <span style={s.count}>{t("smartDiff.filesCount", { count: files.length })}</span>
        {files.length > 0 && (
          <button
            type="button"
            onClick={toggleFiles}
            aria-label={t(filesOpen ? "smartDiff.collapseFiles" : "smartDiff.expandFiles")}
            title={t(filesOpen ? "smartDiff.collapseFiles" : "smartDiff.expandFiles")}
            style={s.toggle}
          >
            <Icon.ChevronsUpDown size={14} />
          </button>
        )}
      </div>
      {open && files.length > 0 && (
        <DiffViewer files={files} commenting={commenting} findings={findings} expandSignal={signal} />
      )}
    </div>
  );
}
