/* RunReviewDropdown — checkbox picker for a multi-agent review.
   Tick up to 5 enabled agents → POST /pulls/:id/multi-agent-run, hand the
   resulting runIds up, then jump to the multi-agent results page. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { useRunEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import {
  MAX_AGENTS,
  alreadyRunningAgents,
  estimateLabelShort,
  resultsHref,
  toggleAgent,
} from "@/lib/multi-agent";
import { notify } from "@/lib/toast";
import { DROPDOWN_WIDTH } from "./constants";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  prNumber,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  prNumber: number;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const tr = useTranslations("runs");
  const router = useRouter();
  const { repoId } = useParams<{ repoId: string }>();
  const { data: agents } = useAgents();
  const { data: estimates } = useRunEstimates();
  const start = useStartMultiAgentRun();

  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const ref = React.useRef<HTMLDivElement>(null);

  const enabled = (agents ?? []).filter((a) => a.enabled);
  const atMax = selected.length >= MAX_AGENTS;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async () => {
    // Display order, not tick order.
    const agentIds = enabled.filter((a) => selected.includes(a.id)).map((a) => a.id);
    onRunStart?.();
    try {
      const res = await start.mutateAsync({ prId, agentIds });
      onRunsStarted?.(res.columns.map((c) => c.run_id));
      setOpen(false);
      router.push(resultsHref(repoId, prNumber));
    } catch (e) {
      const running = alreadyRunningAgents(e);
      notify.error(
        running ? tr("start.alreadyRunning", { agents: running.join(", ") }) : tr("start.failed"),
      );
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={ref} style={s.root}>
      <div onClick={() => setOpen((o) => !o)}>
        <span
          title={warnMerged ? t("runReview.mergedTooltip") : undefined}
          style={warnMerged ? { opacity: 0.6 } : undefined}
        >
          <Button kind={kind} size={size} iconRight="ChevronDown" icon="Sparkles" loading={start.isPending}>
            {start.isPending ? t("runReview.running") : t("runReview.runReview")}
          </Button>
        </span>
      </div>
      {open && (
        <div style={{ ...s.panel, width: DROPDOWN_WIDTH }}>
          {warnMerged && <div style={s.muted}>{t("runReview.mergedWarning")}</div>}
          {enabled.length === 0 ? (
            <>
              <div style={s.heading}>{t("runReview.noEnabled")}</div>
              <Button kind="secondary" size="sm" onClick={() => router.push("/agents")}>
                {t("runReview.goToAgents")}
              </Button>
            </>
          ) : (
            <>
              <div style={s.heading}>{t("runReview.pickAgents")}</div>
              {enabled.map((a) => {
                const checked = selected.includes(a.id);
                const blocked = atMax && !checked;
                const est = estimateLabelShort(estimates?.find((e) => e.agent_id === a.id));
                return (
                  <div
                    key={a.id}
                    style={{ ...s.row, ...(blocked ? s.rowBlocked : null) }}
                    aria-disabled={blocked || undefined}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() => setSelected((cur) => toggleAgent(cur, a.id))}
                      label={
                        <span style={s.rowLabel}>
                          <span style={s.rowName} title={a.name}>
                            {a.name}
                          </span>
                          <span style={s.rowHint}>{est ?? t("runReview.noEstimate")}</span>
                        </span>
                      }
                    />
                  </div>
                );
              })}
              {atMax && <div style={s.muted}>{t("runReview.maxHint")}</div>}
              <div style={s.actions}>
                <Button kind="ghost" size="sm" disabled={selected.length === 0} onClick={() => setSelected([])}>
                  {t("runReview.clear")}
                </Button>
                <Button
                  kind="primary"
                  size="sm"
                  disabled={selected.length === 0 || start.isPending}
                  onClick={run}
                >
                  {t("runReview.runMulti", { count: selected.length })}
                </Button>
              </div>
            </>
          )}
          <button type="button" style={s.configure} onClick={() => router.push("/agents")}>
            {t("runReview.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
