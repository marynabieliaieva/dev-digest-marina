/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional review findings: dot on the file card, card under the line. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { type DiffFindingApi } from "../findings";
import { type DiffExpandSignal } from "../expand";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings,
  expandSignal,
  focusFile,
  focusLine,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
  expandSignal?: DiffExpandSignal;
  /** Deep-link: path (matched exactly) of the file to open, scroll to and highlight. */
  focusFile?: string | null;
  /** Deep-link: new-side line inside `focusFile`. */
  focusLine?: number | null;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          findings={findings}
          expandSignal={expandSignal}
          focus={focusFile != null && f.path === focusFile}
          focusLine={focusLine}
        />
      ))}
    </div>
  );
}
