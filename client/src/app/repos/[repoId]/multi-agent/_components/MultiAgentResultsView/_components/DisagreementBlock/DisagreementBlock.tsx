/* DisagreementBlock — where the selected agents disagree. Rendered in both
   modes; hidden for a single column; shows only a waiting note while any
   agent is still running. A flagged take is a button that opens that agent's
   finding in Tabs mode. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";
import { s } from "./styles";

export function DisagreementBlock({
  conflicts,
  columnCount,
  running,
  onOpenTake,
}: {
  conflicts: Conflict[];
  columnCount: number;
  running: boolean;
  onOpenTake: (take: ConflictTake) => void;
}) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  if (columnCount < 2) return null;

  if (running) {
    return (
      <section style={s.root} aria-label={t("conflicts.title")}>
        <h2 style={s.title}>{t("conflicts.title")}</h2>
        <span style={s.muted}>{t("conflicts.waitingForAll")}</span>
      </section>
    );
  }

  const rows = onlyConflicts ? conflicts.filter((c) => c.is_conflict) : conflicts;

  const verdictText = (take: ConflictTake): string => {
    switch (take.verdict) {
      case "ignored":
        return t("conflicts.didNotFlag");
      case "failed":
      case "cancelled":
        return t(`conflicts.verdict.${take.verdict}`);
      default:
        return t(`severity.${take.verdict.toLowerCase()}`);
    }
  };
  const noteText = (take: ConflictTake): string => {
    if (take.verdict === "ignored" || take.verdict === "failed" || take.verdict === "cancelled") {
      return t(`conflicts.notes.${take.verdict}`);
    }
    return take.note;
  };

  return (
    <section style={s.root} aria-label={t("conflicts.title")}>
      <div style={s.head}>
        <h2 style={s.title}>{t("conflicts.title")}</h2>
        <label style={s.toggle}>
          {t("conflicts.onlyConflicts")}
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
        </label>
      </div>

      {rows.length === 0 ? (
        <span style={s.muted}>{t("conflicts.empty")}</span>
      ) : (
        rows.map((c) => {
          const loc = c.end_line > c.line ? `${c.file}:${c.line}-${c.end_line}` : `${c.file}:${c.line}`;
          return (
            <div key={`${c.file}:${c.line}:${c.end_line}`} style={s.row}>
              <span style={s.loc}>
                <span title={loc}>{loc}</span> · {c.title}
              </span>
              <div style={s.takes}>
                {c.takes.map((take) => {
                  const name = take.persona ?? t("column.deletedAgent");
                  const flagged = take.finding_ids.length > 0;
                  const body = (
                    <>
                      <span style={s.takeName} title={name}>
                        {name}
                      </span>
                      <span style={s.takeVerdict}>{verdictText(take)}</span>
                      <span style={s.takeNote}>{noteText(take)}</span>
                    </>
                  );
                  return flagged ? (
                    <button
                      key={take.run_id}
                      type="button"
                      style={{ ...s.take, ...s.takeButton }}
                      onClick={() => onOpenTake(take)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div key={take.run_id} style={s.take}>
                      {body}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
