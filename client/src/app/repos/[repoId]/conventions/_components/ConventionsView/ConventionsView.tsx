/* /repos/:repoId/conventions — scan a cloned repo for house conventions,
   accept/reject/edit each one, then merge the accepted set into one skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useConventions, useExtractConventions, useUpdateConvention } from "@/lib/hooks/conventions";
import { githubBlobUrl } from "@/lib/github-urls";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { acceptedIds, formatScanTime } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const update = useUpdateConvention();
  const [showModal, setShowModal] = React.useState(false);

  const repoName = activeRepo?.full_name ?? repoId;
  const candidates = data?.candidates ?? [];
  const extraction = data?.extraction ?? null;
  const running = extraction?.status === "running";
  const accepted = acceptedIds(candidates);
  const dropped = extraction ? extraction.candidates_raw - extraction.candidates_kept : 0;

  const patch = (id: string, p: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id, repoId, patch: p });

  const selectAll = async () => {
    await Promise.all(
      candidates
        .filter((c) => c.status !== "accepted")
        .map((c) => update.mutateAsync({ id: c.id, repoId, patch: { status: "accepted" } })),
    );
  };
  const deselectAll = async () => {
    await Promise.all(
      candidates
        .filter((c) => c.status !== "pending")
        .map((c) => update.mutateAsync({ id: c.id, repoId, patch: { status: "pending" } })),
    );
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={[
        { label: repoName, mono: true },
        { label: t("page.crumbLab") },
        { label: t("page.crumbConventions") },
      ]}
    >
      {showModal && (
        <CreateSkillModal repoId={repoId} candidateIds={accepted} onClose={() => setShowModal(false)} />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.headingPrefix") + (repoName || t("page.repoFallback"))}</h1>
            <p style={s.subtitle}>
              {extraction
                ? t("page.candidateCount", { count: extraction.candidates_kept }) +
                  ` · ${extraction.sampled_files} sample files · last scan ${formatScanTime(extraction.created_at)}`
                : t("page.subtitle")}
            </p>
            {dropped > 0 && <p style={s.dropped}>{t("grounding.dropped", { count: dropped })}</p>}
            {extraction?.status === "failed" && (
              <p style={s.dropped}>{t("page.extractionFailed")}{extraction.error ? `: ${extraction.error}` : ""}</p>
            )}
          </div>
          <Button
            kind="secondary"
            icon="RefreshCw"
            loading={running || extract.isPending}
            disabled={running || extract.isPending}
            onClick={() => extract.mutate()}
          >
            {running ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>

        {candidates.length > 0 && (
          <div style={s.toolbar}>
            <Button kind="ghost" size="sm" onClick={selectAll}>
              {t("toolbar.selectAll")}
            </Button>
            <Button kind="ghost" size="sm" onClick={deselectAll}>
              {t("toolbar.deselectAll")}
            </Button>
            <span style={s.toolbarCount}>
              {t("toolbar.acceptedOf", { accepted: accepted.length, total: candidates.length })}
            </span>
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={accepted.length === 0}
              onClick={() => setShowModal(true)}
            >
              {t("toolbar.createSkill")}
            </Button>
          </div>
        )}

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={220} />
            <Skeleton height={220} />
            <Skeleton height={220} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => extract.mutate()}
          />
        )}
        {candidates.length > 0 && (
          <div style={s.grid}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                pending={update.isPending}
                githubUrl={
                  activeRepo
                    ? githubBlobUrl(activeRepo.full_name, activeRepo.default_branch, c.evidence_path, c.evidence_line ?? undefined)
                    : undefined
                }
                onAccept={() => patch(c.id, { status: "accepted" })}
                onReject={() => patch(c.id, { status: "rejected" })}
                onUndo={() => patch(c.id, { status: "pending" })}
                onEditRule={(rule) => patch(c.id, { rule })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
