/* /evals/:agentId — one agent's eval page (L06). Thin shell; the view lives in _components. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useAgent } from "@/lib/hooks/agents";
import { AgentEvalView } from "./_components/AgentEvalView";

export default function AgentEvalPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const t = useTranslations("eval.page");
  const ta = useTranslations("eval.agentPage");
  const { data: agent } = useAgent(agentId);

  return (
    <AppShell
      crumb={[
        { label: t("crumbSkillsLab") },
        { label: ta("breadcrumbDashboard"), href: "/evals" },
        { label: agent?.name ?? "…" },
      ]}
    >
      <AgentEvalView key={agentId} agentId={agentId} />
    </AppShell>
  );
}
