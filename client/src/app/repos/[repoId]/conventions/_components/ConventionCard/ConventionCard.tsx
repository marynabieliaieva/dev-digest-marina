/* ConventionCard — one extracted convention: rule (inline-editable), evidence
   chip (copy path:line), fenced snippet, confidence bar, accept/reject pair.
   A rejected card collapses and greys out but stays listed — undo is one click. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, IconBtn, MonoLink, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { CATEGORY_LABELS } from "./constants";
import { confidenceColor, highlightCode } from "./helpers";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  githubUrl,
  onAccept,
  onReject,
  onUndo,
  onEditRule,
  pending,
}: {
  candidate: ConventionCandidate;
  githubUrl?: string;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  onEditRule: (rule: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);
  const [copied, setCopied] = React.useState(false);

  const rejected = candidate.status === "rejected";
  const location = candidate.evidence_line != null
    ? `${candidate.evidence_path}:${candidate.evidence_line}`
    : candidate.evidence_path;

  const startEdit = () => {
    if (rejected) return;
    setDraft(candidate.rule);
    setEditing(true);
  };
  const saveEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== candidate.rule) onEditRule(trimmed);
    setEditing(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied — non-fatal, just skip the confirmation
    }
  };

  return (
    <div style={s.card(rejected)}>
      <div style={s.topRow}>
        <Badge style={s.categoryBadge}>{CATEGORY_LABELS[candidate.category]}</Badge>
        {candidate.status === "accepted" && <Badge color="var(--ok)">{t("card.accepted")}</Badge>}
        {rejected && <Badge color="var(--text-muted)">{t("card.rejected")}</Badge>}
      </div>

      <div style={s.headerRow}>
        <div style={s.ruleWrap}>
          {editing ? (
            <div style={s.editRow}>
              <textarea
                className="mono"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                autoFocus
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-strong)",
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  resize: "vertical",
                }}
              />
              <div style={s.editActions}>
                <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
                  {t("card.cancel")}
                </Button>
                <Button kind="primary" size="sm" onClick={saveEdit}>
                  {t("card.save")}
                </Button>
              </div>
            </div>
          ) : (
            <p style={s.ruleText} onClick={startEdit} title={t("card.edit")}>
              {candidate.rule}
              {candidate.edited && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)" }}>
                  ({t("card.edit").toLowerCase()}ed)
                </span>
              )}
            </p>
          )}
        </div>

        {!editing && (
          rejected ? (
            <div style={s.actionsCol}>
              <Button kind="ghost" size="sm" onClick={onUndo} disabled={pending}>
                {t("card.undo")}
              </Button>
            </div>
          ) : (
            <div style={s.actionsCol}>
              <Button
                kind="primary"
                size="sm"
                icon="Check"
                onClick={onAccept}
                disabled={pending || candidate.status === "accepted"}
              >
                {candidate.status === "accepted" ? t("card.accepted") : t("card.accept")}
              </Button>
              <Button kind="danger" size="sm" icon="X" onClick={onReject} disabled={pending}>
                {t("card.reject")}
              </Button>
            </div>
          )
        )}
      </div>

      <div style={s.evidenceRow}>
        <span style={s.evidenceChip} className="mono">
          {location}
        </span>
        {githubUrl && (
          <MonoLink href={githubUrl}>
            <Icon.ExternalLink size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
            {t("card.github")}
          </MonoLink>
        )}
        <IconBtn
          icon={copied ? "Check" : "Copy"}
          label={copied ? t("card.copied") : t("card.copy")}
          size={22}
          onClick={copy}
        />
      </div>

      <pre style={s.snippet} className="mono">
        {highlightCode(candidate.evidence_snippet)}
      </pre>

      <div style={s.confidenceRow}>
        <span style={s.confidenceLabel}>{t("card.confidence")}</span>
        <div style={s.confidenceBarWrap}>
          <ProgressBar value={candidate.confidence * 100} color={confidenceColor(candidate.confidence)} />
        </div>
        <span className="tnum" style={s.confidenceValue}>
          {Math.round(candidate.confidence * 100)}%
        </span>
      </div>
    </div>
  );
}
