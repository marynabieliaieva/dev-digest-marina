/* SmartDiffGroup — one role group on Files changed: sticky header (chevron,
   role, description, `● N` finding counter, file count) + the group's files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi, type DiffFindingApi } from "@/components/diff-viewer";
import { COLLAPSED_BY_DEFAULT, ROLE_COLOR, ROLE_DESC_KEY, ROLE_LABEL_KEY } from "./constants";
import { s } from "./styles";
import { chevronStyle } from "./helpers";

export function SmartDiffGroup({
  role,
  files,
  findingFileCount,
  hasReview,
  commenting,
  findings,
}: {
  role: SmartDiffRole;
  /** Files of the group, in server order, with their patches. */
  files: PrFile[];
  /** Files in this group that carry at least one finding line. */
  findingFileCount: number;
  hasReview: boolean;
  commenting: DiffCommentApi;
  findings: DiffFindingApi;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(!COLLAPSED_BY_DEFAULT.has(role));
  const label = t(`smartDiff.${ROLE_LABEL_KEY[role]}`);

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
            ● {findingFileCount}
          </span>
        )}
        <span style={s.count}>{t("smartDiff.filesCount", { count: files.length })}</span>
      </div>
      {open && files.length > 0 && (
        <DiffViewer files={files} commenting={commenting} findings={findings} />
      )}
    </div>
  );
}
