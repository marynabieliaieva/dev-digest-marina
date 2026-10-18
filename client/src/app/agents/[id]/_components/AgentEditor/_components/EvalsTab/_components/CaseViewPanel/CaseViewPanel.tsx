/* CaseViewPanel — read-only view of one eval case (Drawer). The frozen diff is
   rendered as plain text in a <pre> (never as HTML). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Drawer, Markdown } from "@devdigest/ui";
import type { EvalCaseDto } from "@devdigest/shared";
import { readSource } from "../../helpers";
import { s } from "../../styles";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={s.panelSection}>
      <div style={s.panelLabel}>{label}</div>
      {children}
    </section>
  );
}

export function CaseViewPanel({ evalCase, onClose }: { evalCase: EvalCaseDto; onClose: () => void }) {
  const t = useTranslations("eval");
  const { expectation: e, last_result: r } = evalCase;
  const src = readSource(evalCase.input_meta);

  const lastResult = !r
    ? t("evalsTab.view.never")
    : r.error
      ? t("evalsTab.view.resultError", { error: r.error })
      : `${r.pass ? t("evalsTab.view.resultPass") : t("evalsTab.view.resultFail")} · ${t("evalsTab.view.counts", {
          matched: r.matched_count,
          actual: r.actual_count,
        })}`;

  return (
    <Drawer title={t("evalsTab.view.title", { name: evalCase.name })} onClose={onClose} width={640}>
      <Section label={t("evalsTab.view.expectation")}>
        <div>{e.type === "must_find" ? t("evalsTab.view.typeMustFind") : t("evalsTab.view.typeMustNotFlag")}</div>
        <div className="mono" style={{ fontSize: 12.5, marginTop: 4 }}>
          {t("evalsTab.view.location", { file: e.file, start: e.start_line, end: e.end_line })}
        </div>
      </Section>
      <Section label={t("evalsTab.view.sourceFinding")}>
        <div style={{ fontWeight: 600 }}>{src.title ?? e.title}</div>
        {src.rationale && (
          <div style={{ marginTop: 6 }}>
            <div style={s.panelLabel}>{t("evalsTab.view.rationale")}</div>
            <Markdown>{src.rationale}</Markdown>
          </div>
        )}
      </Section>
      {src.prRef && (
        <Section label={t("evalsTab.view.pullRequest")}>
          <span className="mono">{src.prRef}</span>
        </Section>
      )}
      <Section label={t("evalsTab.view.diff")}>
        <pre style={s.pre}>{evalCase.input_diff}</pre>
      </Section>
      <Section label={t("evalsTab.view.lastResult")}>
        <div>{lastResult}</div>
        {r && (
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>
            {t("evalsTab.view.ranAt", { date: new Date(r.ran_at).toLocaleString() })}
          </div>
        )}
      </Section>
    </Drawer>
  );
}
