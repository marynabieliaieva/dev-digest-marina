/* ContextDocPicker — presentational list of project docs with attach toggles,
   drag-to-reorder for attached rows, filter, token total and a preview modal.
   Shared by the Agent and Skill Context tabs; owns no server state. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ContextDoc } from "@devdigest/shared";
import { Badge, Checkbox, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { DocPreviewModal } from "./DocPreviewModal";
import {
  TOKEN_BUDGET,
  buildRows,
  effectiveTokens,
  filterRows,
  reorderAttached,
  type InheritedRef,
  type PickerRow,
} from "./helpers";
import { s } from "./styles";

const TYPE_COLOR: Record<string, string> = {
  specs: "var(--accent-text)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export type ContextDocPickerProps = {
  docs: ContextDoc[] | undefined;
  loading?: boolean;
  error?: boolean;
  /** Ordered attached paths. */
  attached: string[];
  inherited?: InheritedRef[];
  onChange: (paths: string[]) => void;
  repoId: string;
  repoName: string;
  budgetWarning?: boolean;
  badgeVariant: "ofTotal" | "count";
};

export function ContextDocPicker({
  docs,
  loading,
  error,
  attached,
  inherited = [],
  onChange,
  repoId,
  repoName,
  budgetWarning,
  badgeVariant,
}: ContextDocPickerProps) {
  const t = useTranslations("contextPicker");
  const [search, setSearch] = React.useState("");
  const [dragging, setDragging] = React.useState<number | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  // Optimistic local order while a reorder round-trips; reset when the prop changes.
  const [draft, setDraft] = React.useState<string[] | null>(null);
  React.useEffect(() => setDraft(null), [attached]);
  const order = draft ?? attached;

  const rows = React.useMemo(() => buildRows(docs, order, inherited), [docs, order, inherited]);

  if (error) return <ErrorState body={t("listError")} />;
  if (loading || !docs) {
    return (
      <div style={s.wrap}>
        <Skeleton height={28} width={220} />
        <Skeleton height={180} />
      </div>
    );
  }

  const attachedCount = rows.filter((r) => r.state === "attached" || r.state === "missing").length;
  const tokens = effectiveTokens(rows);
  const overBudget = !!budgetWarning && tokens > TOKEN_BUDGET;
  const visible = filterRows(rows, search);

  const toggle = (row: PickerRow) => {
    const isOn = order.includes(row.path);
    onChange(isOn ? order.filter((p) => p !== row.path) : [...order, row.path]);
  };

  const onDrop = (to: number) => {
    if (dragging === null) return;
    const next = reorderAttached(order, dragging, to);
    setDragging(null);
    if (next !== order) {
      setDraft(next);
      onChange(next);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Badge color="var(--accent)">
          {badgeVariant === "ofTotal"
            ? t("badgeOfTotal", { attached: attachedCount, total: rows.length })
            : t("badgeCount", { attached: attachedCount })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filterPlaceholder")}
            aria-label={t("filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={s.empty}>{t("empty")}</p>
      ) : visible.length === 0 ? (
        <p style={s.empty}>{t("noMatches")}</p>
      ) : (
        <ul style={s.list}>
          {visible.map((row) => {
            const orderIndex = order.indexOf(row.path);
            const canDrag = orderIndex >= 0;
            const checked = row.state !== "available";
            const readOnly = row.state === "inherited";
            return (
              <li
                key={row.path}
                draggable={canDrag}
                onDragStart={canDrag ? () => setDragging(orderIndex) : undefined}
                onDragOver={canDrag ? (e) => e.preventDefault() : undefined}
                onDrop={canDrag ? () => onDrop(orderIndex) : undefined}
                onDragEnd={() => setDragging(null)}
                style={s.row(checked, dragging === orderIndex && canDrag, canDrag)}
              >
                <span style={s.handle(canDrag)} aria-hidden="true">
                  <Icon.Menu size={14} />
                </span>
                <div style={s.checkboxWrap}>
                  <span style={readOnly ? s.readOnlyCheckbox : undefined} aria-disabled={readOnly || undefined}>
                    <Checkbox
                      checked={checked}
                      onChange={readOnly ? undefined : () => toggle(row)}
                      label={
                        <span className="mono" style={s.name} title={row.path}>
                          {row.name}
                        </span>
                      }
                    />
                  </span>
                  {row.folder && (
                    <span className="mono" style={s.folder}>
                      {row.folder}
                    </span>
                  )}
                </div>
                {row.state === "missing" && <span style={s.note(true)}>{t("missing", { repo: repoName })}</span>}
                {row.state === "inherited" && row.via && <span style={s.note(false)}>{t("via", { skill: row.via })}</span>}
                {row.tooLarge && <span style={s.note(true)}>{t("tooLarge")}</span>}
                {row.type && (
                  <span className="mono" style={s.typeChip(TYPE_COLOR[row.type] ?? "var(--text-secondary)")}>
                    {t(`type.${row.type}`)}
                  </span>
                )}
                {row.state !== "missing" && (
                  <button
                    type="button"
                    style={s.previewBtn}
                    aria-label={t("previewLabel", { path: row.path })}
                    onClick={() => setPreviewPath(row.path)}
                  >
                    <Icon.Eye size={13} />
                    {t("preview")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div style={s.footer}>
        <span className="mono" style={s.total(overBudget)}>
          {t("tokenTotal", { tokens })}
          {overBudget && <> — {t("budgetWarning")}</>}
        </span>
      </div>

      {previewPath && <DocPreviewModal repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  );
}
