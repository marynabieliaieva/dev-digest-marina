/* ContextTab — which project docs this agent attaches, in prompt order. Saves
   through the dedicated context endpoint, never the versioned agent update. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { ContextDocPicker } from "@/components/context-doc-picker/ContextDocPicker";
import { useActiveRepo } from "@/lib/repo-context";
import { useAgentContext, useContextDocs, useSetAgentContext } from "@/lib/hooks/project-context";
import { isContextUnavailable } from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { repoId, activeRepo } = useActiveRepo();
  const docsQuery = useContextDocs(repoId);
  const contextQuery = useAgentContext(agent.id);
  const save = useSetAgentContext(agent.id);

  const attached = contextQuery.data?.paths ?? [];
  const inherited = React.useMemo(
    () => (contextQuery.data?.inherited ?? []).map((i) => ({ path: i.path, skill_name: i.skill_name })),
    [contextQuery.data],
  );

  // No repo / no clone: the list can't be scanned, but attachments still show (as missing).
  const unavailable = !repoId || isContextUnavailable(docsQuery.error);
  const listError = docsQuery.isError && !unavailable;
  const docs = unavailable ? [] : docsQuery.data?.docs;
  const loading = contextQuery.isLoading || (!unavailable && docsQuery.isLoading);

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("editor.context.title")}</h2>
      <p style={s.hint}>{t("editor.context.orderHint")}</p>
      {unavailable && <p style={s.note}>{t(repoId ? "editor.context.unavailable" : "editor.context.noRepo")}</p>}
      <ContextDocPicker
        docs={docs}
        loading={loading}
        error={listError || contextQuery.isError}
        attached={attached}
        inherited={inherited}
        onChange={(paths) => save.mutate({ paths })}
        repoId={repoId ?? ""}
        repoName={activeRepo?.full_name ?? repoId ?? ""}
        budgetWarning
        badgeVariant="ofTotal"
      />
      <p style={s.injected}>{t("editor.context.injected")}</p>
    </div>
  );
}
