/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel, evalCaseErrorKey } from "./helpers";
import { notify } from "@/lib/toast";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
  onCreateEvalCase,
  agentName,
  showLearn = false,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Creates an eval case from this finding; rejects with an `ApiError`. The
   *  "Turn into eval case" button renders only when this is provided. */
  onCreateEvalCase?: () => Promise<unknown>;
  /** Name of the agent that produced the finding (toast copy). */
  agentName?: string | null;
  /** Opt-in per call site: renders a disabled "Learn" button ("Not available yet"). */
  showLearn?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const decided = accepted || dismissed;
  const idBase = React.useId();
  const hintId = `${idBase}-eval-hint`;
  const learnHintId = `${idBase}-learn-hint`;
  const [creating, setCreating] = React.useState(false);
  const inFlight = React.useRef(false);
  // `eval_case_id` is the single source of truth; the create hook updates/invalidates
  // the reviews cache on success and on a 409 `already_eval_case`.
  const inSet = !!f.eval_case_id;

  const handleCreateEvalCase = async () => {
    // The ref (not state) guards a double click that lands before the re-render.
    if (!onCreateEvalCase || inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    try {
      await onCreateEvalCase();
      notify.success(
        agentName ? t("finding.evalCase.created", { agent: agentName }) : t("finding.evalCase.createdGeneric"),
      );
    } catch (err) {
      const key = evalCaseErrorKey(err);
      notify.error(t(`finding.evalCase.errors.${key}`));
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  };

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor)}>
      <div onClick={() => setExpanded((e) => !e)} style={{ ...s.header, ...s.dim(muted) }}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.dim(muted)}>
            <div style={s.prose}>
              <Markdown>{f.rationale}</Markdown>
            </div>
            {f.suggestion && (
              <div style={s.suggestionWrap}>
                <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
                <div style={s.prose}>
                  <Markdown>{f.suggestion}</Markdown>
                </div>
              </div>
            )}
          </div>

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending || accepted}
              active={accepted}
              style={s.acceptBtn}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="X"
              disabled={pending || dismissed}
              active={dismissed}
              style={s.dismissBtn}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {showLearn && (
              <>
                <Button
                  kind="secondary"
                  size="sm"
                  disabled
                  aria-describedby={learnHintId}
                  title={t("finding.learnUnavailable")}
                >
                  {t("finding.learn")}
                </Button>
                <span id={learnHintId} style={s.srOnly}>
                  {t("finding.learnUnavailable")}
                </span>
              </>
            )}
            {onCreateEvalCase && (
              <>
                <Button
                  kind="secondary"
                  size="sm"
                  icon={inSet ? "Check" : "FlaskConical"}
                  style={s.evalBtn}
                  disabled={inSet || !decided || creating}
                  aria-describedby={!decided && !inSet ? hintId : undefined}
                  title={!decided && !inSet ? t("finding.evalCase.undecidedHint") : undefined}
                  onClick={handleCreateEvalCase}
                >
                  {inSet ? t("finding.evalCase.inSet") : t("finding.evalCase.action")}
                </Button>
                {!decided && !inSet && (
                  <span id={hintId} style={s.srOnly}>
                    {t("finding.evalCase.undecidedHint")}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
