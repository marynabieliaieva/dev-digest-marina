/* Multi-Agent Review — /repos/:repoId/multi-agent.
   Query: pr=<number> results, configure=1 configure screen, view=columns|tabs,
   run=<runId>, finding=<findingId>. Without pr the configure screen shows. */
"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePulls } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConfigureRunView } from "./_components/ConfigureRunView";
import { MultiAgentResultsView } from "./_components/MultiAgentResultsView";

export default function MultiAgentPage() {
  const t = useTranslations("runs");
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls } = usePulls(repoId);

  const rawPr = Number.parseInt(search.get("pr") ?? "", 10);
  const prNumber = Number.isInteger(rawPr) && rawPr >= 1 ? rawPr : null;
  const configure = search.get("configure") === "1";
  const prId = prNumber != null ? (pulls?.find((p) => p.number === prNumber)?.id ?? null) : null;

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {prNumber == null || configure ? (
        <ConfigureRunView repoId={repoId} prNumber={prNumber} prId={prId} />
      ) : (
        <MultiAgentResultsView repoId={repoId} prNumber={prNumber} prId={prId} />
      )}
    </AppShell>
  );
}
