/* CompareModal — two done batches side by side: metric tiles old → new with a
   signed delta, and the system-prompt diff. `Modal` is portal-free and has no
   focus handling, so this wrapper adds initial focus, a Tab trap, Escape to
   close and focus return to the opener (pattern: DocPreviewModal). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, Skeleton } from "@devdigest/ui";
import { deltaPts, deltaUsd, pct, usd } from "@/lib/eval-format";
import { useEvalCompare } from "@/lib/hooks/evals";
import { EvalMetricTile } from "@/components/eval-metric-tile";
import { METRIC_COLORS } from "../../../helpers";
import { skillNames } from "./helpers";
import { s } from "./styles";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function CompareModal({
  base,
  head,
  onClose,
}: {
  /** Older batch id. */
  base: string;
  /** Newer batch id. */
  head: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const compare = useEvalCompare(base, head);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !rootRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const c = compare.data;
  const title = c
    ? t("compare.title", { base: c.base.agent_version, head: c.head.agent_version })
    : t("compare.promptHeading");
  const unchanged = !!c && c.prompt_diff.every((l) => l.op === "same");
  const baseSkills = c ? skillNames(c.base.config_snapshot) : [];
  const headSkills = c ? skillNames(c.head.config_snapshot) : [];
  const skillsChanged = baseSkills.join("\n") !== headSkills.join("\n");
  const list = (names: string[]) => (names.length > 0 ? names.join(", ") : t("compare.noSkills"));

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <Modal
        width={880}
        title={title}
        onClose={onClose}
        footer={
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
        }
      >
        {compare.isError ? (
          <p role="alert" style={s.body}>
            {compare.error instanceof Error ? compare.error.message : ""}
          </p>
        ) : !c ? (
          <div style={s.body} aria-label={t("compare.loading")}>
            <Skeleton height={120} />
          </div>
        ) : (
          <div style={s.body}>
            <div style={{ display: "flex", gap: 12 }}>
              <EvalMetricTile
                compact
                label={t("metrics.recall")}
                value={c.head.recall}
                valueText={`${pct(c.base.recall)} → ${pct(c.head.recall)}`}
                deltaText={deltaPts(c.delta.recall, 0)}
                color={METRIC_COLORS.recall}
              />
              <EvalMetricTile
                compact
                label={t("metrics.precision")}
                value={c.head.precision}
                valueText={`${pct(c.base.precision)} → ${pct(c.head.precision)}`}
                deltaText={deltaPts(c.delta.precision, 0)}
                color={METRIC_COLORS.precision}
              />
              <EvalMetricTile
                compact
                label={t("metrics.citation")}
                value={c.head.citation_accuracy}
                valueText={`${pct(c.base.citation_accuracy)} → ${pct(c.head.citation_accuracy)}`}
                deltaText={deltaPts(c.delta.citation_accuracy, 0)}
                color={METRIC_COLORS.citation}
              />
              <EvalMetricTile
                compact
                label={t("metrics.cost")}
                value={null}
                valueText={`${usd(c.base.cost_usd)} → ${usd(c.head.cost_usd)}`}
                deltaText={deltaUsd(c.delta.cost_usd, 0)}
              />
            </div>

            {c.model_changed && (
              <p style={s.meta}>
                {t("compare.model", {
                  old: c.base.config_snapshot?.model ?? "—",
                  new: c.head.config_snapshot?.model ?? "—",
                })}
              </p>
            )}
            {skillsChanged && (
              <p style={s.meta}>{t("compare.skills", { old: list(baseSkills), new: list(headSkills) })}</p>
            )}

            <h3 style={s.heading}>{t("compare.promptHeading")}</h3>
            {unchanged ? (
              <p style={s.meta}>{t("compare.unchanged")}</p>
            ) : (
              <pre style={s.diff}>
                {c.prompt_diff.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      ...s.line,
                      ...(l.op === "add" ? s.add : l.op === "del" ? s.del : null),
                    }}
                  >
                    <span aria-hidden="true" style={s.marker}>
                      {l.op === "add" ? "+" : l.op === "del" ? "−" : " "}
                    </span>
                    {l.op !== "same" && (
                      <span style={s.srOnly}>{l.op === "add" ? t("compare.added") : t("compare.removed")}: </span>
                    )}
                    <span>{l.text}</span>
                  </div>
                ))}
              </pre>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
