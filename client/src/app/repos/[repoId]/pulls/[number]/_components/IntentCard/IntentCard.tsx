/* IntentCard — the PR's derived intent (summary, scope, risks, sources) on the
   Overview tab. Owns its own derive mutation; every string is rendered as a
   React text node (the content is untrusted LLM/PR-derived text). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, SectionLabel } from "@devdigest/ui";
import type { PrIntentRecord } from "@devdigest/shared";
import { useDeriveIntent, usePrIntent } from "../../../../../../../lib/hooks/intent";
import { shortSha } from "./helpers";
import { s } from "./styles";

function ScopeList({
  heading,
  items,
  variant,
}: {
  heading: string;
  items: string[];
  variant: "in" | "out";
}) {
  const Mark = variant === "in" ? Icon.CheckCircle : Icon.XCircle;
  return (
    <div>
      <h4 style={s.heading}>{heading}</h4>
      <ul style={s.scopeList}>
        {items.map((item, i) => (
          <li key={`${i}-${item}`} style={s.scopeItem}>
            <Mark
              size={14}
              aria-hidden="true"
              style={{ ...s.scopeMark, color: variant === "in" ? "var(--ok)" : "var(--text-muted)" }}
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyBody({ intent }: { intent: PrIntentRecord }) {
  const t = useTranslations("intent");
  return (
    <>
      <blockquote style={s.summary}>{intent.summary}</blockquote>

      <div style={s.columns}>
        <ScopeList heading={t("inScope")} items={intent.in_scope} variant="in" />
        <ScopeList heading={t("outOfScope")} items={intent.out_of_scope} variant="out" />
      </div>

      {intent.risk_areas.length > 0 && (
        <div>
          <h4 style={s.heading}>{t("riskAreas")}</h4>
          <div style={s.chips}>
            {intent.risk_areas.map((r, i) => (
              <span key={`${i}-${r}`} style={s.chip}>
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {intent.sources.length > 0 && (
        <div>
          <h4 style={s.heading}>{t("sources")}</h4>
          <ul style={{ ...s.list, listStyle: "none", paddingLeft: 0 }}>
            {intent.sources.map((src, i) => (
              <li key={`${i}-${src.kind}-${src.ref}`} style={s.sourceRow}>
                <span style={s.sourceStatus}>{t(`sourceKind.${src.kind}`)}</span>
                <span style={s.sourceRef}>{src.ref}</span>
                <span style={s.sourceStatus}>{t(`sourceStatus.${src.status}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {intent.missing_context.length > 0 && (
        <section aria-label={t("missingContext")} style={s.warning}>
          <h4 style={s.heading}>{t("missingContext")}</h4>
          <ul style={s.list}>
            {intent.missing_context.map((m, i) => (
              <li key={`${i}-${m}`}>{m}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function IntentCard({ prId }: { prId: string }) {
  const t = useTranslations("intent");
  const { data } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  const intent = data?.intent ?? null;
  const pending = derive.isPending;
  const onDerive = () => derive.mutate();

  const label = pending ? t("deriving") : intent ? t("rederive") : t("derive");
  const button = (
    <Button size="sm" icon="RefreshCw" loading={pending} disabled={pending} onClick={onDerive}>
      {label}
    </Button>
  );

  const right = (
    <span style={s.headerRight}>
      {intent?.status === "ready" && (
        <span>
          {t("confidence.label")}: {t(`confidence.${intent.confidence}`)}
        </span>
      )}
      {button}
    </span>
  );

  return (
    <section>
      <SectionLabel icon="Sparkles" right={right}>
        {t("title")}
      </SectionLabel>
      <div style={s.card}>
        {intent?.stale && (
          <div role="status" style={s.warning}>
            {t("stale", { sha: shortSha(intent.head_sha) })}
          </div>
        )}

        {pending && (
          <div role="status" style={s.muted}>
            {t("derivingHint")}
          </div>
        )}

        {derive.isError && !pending && (
          <div role="alert" style={s.error}>
            {t("deriveError", { message: derive.error instanceof Error ? derive.error.message : "unknown error" })}
          </div>
        )}

        {!intent && <div style={s.muted}>{t("empty")}</div>}

        {intent?.status === "failed" && (
          <div role="alert" style={s.error}>
            <strong>{t("failed")}</strong>
            {intent.error ? `: ${intent.error}` : null}
          </div>
        )}

        {intent?.status === "ready" && <ReadyBody intent={intent} />}
      </div>
    </section>
  );
}
