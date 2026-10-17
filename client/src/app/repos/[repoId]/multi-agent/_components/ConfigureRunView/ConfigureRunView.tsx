/* ConfigureRunView — pick a PR and up to 5 enabled agents, then start a
   multi-agent review. Lives at /repos/:repoId/multi-agent (no ?pr, or ?configure=1). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, SelectInput } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks";
import { useMultiAgentRun, useRunEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import {
  MAX_AGENTS,
  alreadyRunningAgents,
  configureHref,
  estimateFooter,
  estimateLabelCard,
  resultsHref,
  selectFirst,
  toggleAgent,
} from "@/lib/multi-agent";
import { notify } from "@/lib/toast";
import { s } from "./styles";

const NO_PR = "";

export function ConfigureRunView({
  repoId,
  prNumber,
  prId,
}: {
  repoId: string;
  /** Pre-selected PR number from the URL, or null. */
  prNumber: number | null;
  /** uuid of the selected PR (resolved by the page), or null. */
  prId: string | null;
}) {
  const t = useTranslations("runs");
  const router = useRouter();
  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useRunEstimates();
  const { data: latest } = useMultiAgentRun(prId);
  const start = useStartMultiAgentRun();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [seededFor, setSeededFor] = React.useState<string | null>(null);

  const enabled = React.useMemo(() => (agents ?? []).filter((a) => a.enabled), [agents]);
  const enabledIds = React.useMemo(() => enabled.map((a) => a.id), [enabled]);

  // AC-24: pre-tick the latest multi-run's agents, once per PR. A read, not a
  // mutation. Switching PR re-seeds (and clears the old selection) because
  // seededFor no longer matches prId.
  React.useEffect(() => {
    if (!prId || seededFor === prId || latest === undefined || !agents) return;
    setSeededFor(prId);
    if (latest) {
      const ids = latest.columns
        .map((c) => c.agent_id)
        .filter((id): id is string => !!id && enabledIds.includes(id));
      setSelected(selectFirst(ids));
    } else {
      setSelected([]);
    }
  }, [seededFor, prId, latest, agents, enabledIds]);

  const estFor = (id: string) => estimates?.find((e) => e.agent_id === id);
  const footer = estimateFooter(selected.map(estFor));
  const atMax = selected.length >= MAX_AGENTS;
  const canRun = !!prId && prNumber != null && selected.length > 0 && !start.isPending;

  const run = async () => {
    if (!prId || prNumber == null) return;
    const agentIds = enabledIds.filter((id) => selected.includes(id));
    try {
      await start.mutateAsync({ prId, agentIds });
      router.push(resultsHref(repoId, prNumber));
    } catch (e) {
      const running = alreadyRunningAgents(e);
      notify.error(
        running ? t("start.alreadyRunning", { agents: running.join(", ") }) : t("start.failed"),
      );
    }
  };

  const prOptions = [
    { value: NO_PR, label: t("page.selectPr") },
    ...(pulls ?? []).map((p) => ({
      value: String(p.number),
      label: t("page.prItem", { number: p.number, title: p.title }),
    })),
  ];

  return (
    <div style={s.root}>
      <h1 style={s.h1}>{t("page.configure.title")}</h1>

      <SelectInput
        mono={false}
        value={prNumber != null ? String(prNumber) : NO_PR}
        options={prOptions}
        onChange={(v) => router.replace(configureHref(repoId, v === NO_PR ? undefined : Number(v)))}
      />

      {!prId ? (
        <EmptyState title={t("page.configure.pickPrFirst")} icon="GitPullRequest" />
      ) : enabled.length === 0 ? (
        <EmptyState
          icon="Cpu"
          title={t("page.noAgents.title")}
          body={t("page.noAgents.body")}
          cta={t("page.noAgents.cta")}
          onCta={() => router.push("/agents")}
        />
      ) : (
        <>
          <div style={s.toolbar}>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => setSelected(selectFirst(enabledIds))}
            >
              {t("page.configure.selectAll")}
            </Button>
            {atMax && <span style={s.hint}>{t("page.configure.maxHint")}</span>}
          </div>
          <div style={s.cards}>
            {enabled.map((a) => {
              const checked = selected.includes(a.id);
              const blocked = atMax && !checked;
              const est = estimateLabelCard(estFor(a.id));
              return (
                <div
                  key={a.id}
                  style={{ ...s.card, ...(blocked ? s.cardBlocked : null) }}
                  aria-disabled={blocked || undefined}
                >
                  <Checkbox
                    checked={checked}
                    onChange={() => setSelected((cur) => toggleAgent(cur, a.id))}
                    label={
                      <span style={s.cardBody}>
                        <span style={s.cardName} title={a.name}>
                          {a.name}
                        </span>
                        <span style={s.cardDesc} title={a.description}>
                          {a.description}
                        </span>
                      </span>
                    }
                  />
                  <span style={s.cardEst}>{est ?? t("page.configure.noEstimate")}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={s.footer}>
        <span style={s.footerText}>
          {footer ? (
            <>
              {t("page.configure.footer", { estimate: footer.text })}
              {footer.partial && ` ${t("page.configure.partial")}`}
            </>
          ) : (
            t("page.configure.noEstimate")
          )}
        </span>
        <Button kind="primary" disabled={!canRun} loading={start.isPending} onClick={run}>
          {t("page.configure.runButton", { count: selected.length })}
        </Button>
      </div>
    </div>
  );
}
