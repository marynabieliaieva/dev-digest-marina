/* BlastRadiusCard — indexed blast radius of the PR on the Overview tab:
   stats, Tree/Graph toggle, loading/error/empty/degraded states. Repo-derived
   strings are rendered as plain React text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import { usePrBlast } from "../../../../../../../lib/hooks/blast";
import { useResyncRepoIntel } from "../../../../../../../lib/hooks/repo-intel";
import { BlastGraph } from "./BlastGraph";
import { BlastTree } from "./BlastTree";
import { computeStats } from "./helpers";
import { s } from "./styles";

type View = "tree" | "graph";
const VIEWS: View[] = ["tree", "graph"];

interface BlastRadiusCardProps {
  prId: string;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);
  const resync = useResyncRepoIntel(repoId);
  const [view, setView] = React.useState<View>("tree");

  const toggle = (
    <span style={s.toggle} role="group" aria-label={t("viewLabel")}>
      {VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          style={{ ...s.toggleBtn, ...(view === v ? s.toggleBtnActive : null) }}
          onClick={() => setView(v)}
        >
          {t(`view.${v}`)}
        </button>
      ))}
    </span>
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div role="status" style={s.muted}>
        {t("loading")}
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div role="alert" style={s.error}>
        <span>{t("error")}</span>
        <Button size="sm" onClick={() => refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  } else {
    const { blast } = data;
    const stats = computeStats(blast);
    const statItems = [
      ["symbols", stats.symbols],
      ["callers", stats.callers],
      ["endpoints", stats.endpoints],
      ["crons", stats.crons],
    ] as const;
    body = (
      <>
        {data.degraded && (
          <div role="status" style={s.badge}>
            <span>
              <strong>{t("degraded.title")}</strong>
              {data.reason ? `: ${t(`reason.${data.reason}`)}` : null}
            </span>
            <Button
              size="sm"
              icon="RefreshCw"
              loading={resync.isPending}
              disabled={resync.isPending}
              onClick={() => resync.mutate(undefined, { onSuccess: () => refetch() })}
            >
              {resync.isPending ? t("resyncing") : t("resync")}
            </Button>
          </div>
        )}

        <dl style={{ ...s.stats, margin: 0 }}>
          {statItems.map(([key, value]) => (
            <div key={key} style={s.stat}>
              <dd style={{ ...s.statValue, margin: 0 }}>{value}</dd>
              <dt style={s.statLabel}>{t(`stat.${key}`)}</dt>
            </div>
          ))}
        </dl>

        {view === "graph" ? (
          <BlastGraph blast={blast} />
        ) : blast.downstream.length === 0 ? (
          !data.degraded && (
            <div style={s.muted}>{t("noDownstream", { count: blast.changed_symbols.length })}</div>
          )
        ) : (
          <BlastTree blast={blast} repoFullName={repoFullName} sha={data.indexed_sha ?? headSha} />
        )}
      </>
    );
  }

  return (
    <section>
      <SectionLabel icon="GitBranch" right={toggle}>
        {t("title")}
      </SectionLabel>
      <div style={s.card}>{body}</div>
    </section>
  );
}
