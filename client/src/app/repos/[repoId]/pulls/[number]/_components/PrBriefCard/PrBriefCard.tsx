/* PrBriefCard — the PR brief (summary, risks, review focus, data gaps) on the
   Overview tab. Every model-produced string renders as a plain React text node
   (untrusted LLM output: no HTML, no Markdown). Copy comes from the `brief`
   i18n namespace. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon, SectionLabel } from "@devdigest/ui";
import type { PrBrief, Risk } from "@devdigest/shared";
import { useBrief } from "../../../../../../../lib/hooks/brief";
import { buildDiffHref, formatCost, severityColor, shortSha } from "./helpers";
import { s } from "./styles";

export interface PrBriefCardProps {
  prId: string;
  /** From the resolved PR detail; the brief query stays disabled until it is known. */
  headSha: string | undefined;
  repoId: string;
  number: number | string;
  /** Paths changed in this PR; anything else is not navigable. */
  changedFiles: string[];
  onNavigate: (href: string) => void;
}

function FileRef({
  file,
  line,
  label,
  navigable,
  onOpen,
  notInDiff,
}: {
  file: string;
  line?: number;
  label: string;
  navigable: boolean;
  onOpen: () => void;
  notInDiff: string;
}) {
  if (!navigable) {
    return (
      <span style={{ ...s.refStatic, ...s.mono }} title={file}>
        {label} <span style={s.note}>{notInDiff}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      style={{ ...s.refButton, ...s.mono }}
      title={file}
      aria-label={label}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

function RiskRow({
  risk,
  changedFiles,
  onOpen,
}: {
  risk: Risk;
  changedFiles: Set<string>;
  onOpen: (file: string) => void;
}) {
  const t = useTranslations("brief");
  const [open, setOpen] = React.useState(false);
  return (
    <li>
      <button type="button" style={s.rowButton} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span
          role="img"
          aria-label={t("card.severity.label", { severity: t(`card.severity.${risk.severity}`) })}
          style={{ color: severityColor(risk.severity), display: "inline-flex" }}
        >
          <Icon.AlertTriangle size={14} aria-hidden="true" />
        </span>
        <span>{risk.title}</span>
        <span style={s.note}>{t(`card.severity.${risk.severity}`)}</span>
      </button>
      {risk.file_refs.length > 0 && (
        <div style={s.refs}>
          {risk.file_refs.map((file, i) => (
            <FileRef
              key={`${i}-${file}`}
              file={file}
              label={file}
              navigable={changedFiles.has(file)}
              onOpen={() => onOpen(file)}
              notInDiff={t("card.notInDiff")}
            />
          ))}
        </div>
      )}
      {open && <p style={s.explanation}>{risk.explanation}</p>}
    </li>
  );
}

function BriefBody({
  brief,
  changedFiles,
  repoId,
  number,
  onNavigate,
}: { brief: PrBrief } & Pick<PrBriefCardProps, "repoId" | "number" | "onNavigate"> & {
    changedFiles: Set<string>;
  }) {
  const t = useTranslations("brief");
  return (
    <>
      <p style={s.summary}>{brief.summary}</p>

      {brief.data_gaps.length > 0 && (
        <section aria-label={t("card.gaps.title")} style={s.gaps}>
          <h4 style={s.heading}>{t("card.gaps.title")}</h4>
          <ul style={s.list}>
            {brief.data_gaps.map((g, i) => (
              <li key={`${i}-${g.source}-${g.status}`}>
                {t("card.gaps.phrase", {
                  source: t(`card.gaps.source.${g.source}`),
                  status: t(`card.gaps.status.${g.status}`),
                  reason: g.reason,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <h4 style={s.heading}>{t("block.risks")}</h4>
        {brief.risks.risks.length === 0 ? (
          <div style={s.muted}>{t("noRisks")}</div>
        ) : (
          <ul style={s.list}>
            {brief.risks.risks.map((risk, i) => (
              <RiskRow
                key={`${i}-${risk.title}`}
                risk={risk}
                changedFiles={changedFiles}
                onOpen={(file) => onNavigate(buildDiffHref(repoId, number, file))}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 style={s.heading}>{t("card.reviewFocus")}</h4>
        {brief.review_focus.length === 0 ? (
          <div style={s.muted}>{t("card.noFocus")}</div>
        ) : (
          <ul style={s.list}>
            {brief.review_focus.map((item, i) => (
              <li key={`${i}-${item.file}-${item.line}`}>
                <FocusItem
                  file={item.file}
                  line={item.line}
                  reason={item.reason}
                  navigable={changedFiles.has(item.file)}
                  onOpen={() => onNavigate(buildDiffHref(repoId, number, item.file, item.line))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function FocusItem({
  file,
  line,
  reason,
  navigable,
  onOpen,
}: {
  file: string;
  line: number;
  reason: string;
  navigable: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("brief");
  const text = `${file}:${line} — ${reason}`;
  if (!navigable) {
    return (
      <div style={s.rowStatic}>
        <span title={file} style={s.mono}>
          {text}
        </span>
        <span style={s.note}>{t("card.notInDiff")}</span>
      </div>
    );
  }
  return (
    <button type="button" style={s.rowButton} title={file} aria-label={text} onClick={onOpen}>
      <span style={s.mono}>{text}</span>
    </button>
  );
}

function Skeleton() {
  return (
    <div data-testid="brief-skeleton" aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...s.skeleton, width: "90%" }} />
      <div style={{ ...s.skeleton, width: "75%" }} />
      <div style={{ ...s.skeleton, width: "60%" }} />
    </div>
  );
}

export function PrBriefCard({ prId, headSha, repoId, number, changedFiles, onNavigate }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading, pending, error, generate, retry } = useBrief(prId, headSha);
  const files = React.useMemo(() => new Set(changedFiles), [changedFiles]);

  const brief = data?.brief ?? null;
  const showSkeleton = !brief && (pending || (isLoading && !!headSha));
  const missingKey =
    typeof error === "object" &&
    error !== null &&
    (error as { details?: { reason?: string } }).details?.reason === "missing_key";

  const right = (
    <span style={s.headerRight}>
      {brief && (
        <span>
          {t("card.generatedFor", { sha: shortSha(brief.head_sha), model: brief.model })}
          {brief.cost_usd !== null && ` · ${t("card.cost", { cost: formatCost(brief.cost_usd) })}`}
        </span>
      )}
      {brief && (
        <Button
          size="sm"
          icon="RefreshCw"
          aria-label={t("card.refresh")}
          title={t("card.refresh")}
          loading={pending}
          disabled={pending}
          onClick={() => generate("refresh")}
        />
      )}
    </span>
  );

  return (
    <section aria-busy={pending}>
      <SectionLabel icon="Sparkles" right={right}>
        {t("card.title")}
      </SectionLabel>
      <div style={s.card}>
        <div aria-live="polite" style={s.badge}>
          {pending && (brief ? t("card.updating") : t("card.generating"))}
        </div>

        {error && (
          <div role="alert" style={s.error}>
            <strong>{t("card.errors.title")}</strong>
            <span>{error instanceof Error && error.message ? error.message : t("card.errors.unknown")}</span>
            {missingKey && (
              <span>
                {t("card.settingsHint")} <Link href="/settings/models">{t("card.settingsLink")}</Link>
              </span>
            )}
            <div style={s.actions}>
              <Button size="sm" onClick={retry} disabled={pending}>
                {t("card.retry")}
              </Button>
            </div>
          </div>
        )}

        {showSkeleton && (
          <>
            <Skeleton />
            <div style={s.actions}>
              <Button size="sm" icon="Sparkles" disabled onClick={() => generate("refresh")}>
                {t("card.generate")}
              </Button>
            </div>
          </>
        )}

        {!brief && !showSkeleton && (
          <>
            <div style={s.muted}>{t("unavailable")}</div>
            <div style={s.note}>{t("unavailableHint")}</div>
            <div style={s.actions}>
              <Button size="sm" icon="Sparkles" onClick={() => generate("refresh")} disabled={pending}>
                {t("card.generate")}
              </Button>
            </div>
          </>
        )}

        {brief && (
          <BriefBody brief={brief} changedFiles={files} repoId={repoId} number={number} onNavigate={onNavigate} />
        )}
      </div>
    </section>
  );
}
