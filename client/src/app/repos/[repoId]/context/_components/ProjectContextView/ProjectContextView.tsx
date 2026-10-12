/* /repos/:repoId/context — read-only browser for the repo's context documents
   (specs / docs / insights found in the local clone). */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Markdown, Popover, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useRefreshRepo } from "@/lib/hooks/core";
import { useContextDoc, useContextDocs } from "@/lib/hooks/project-context";
import { DocTree } from "../DocTree";
import { splitPath } from "../DocTree/helpers";
import { formatCount, isContextUnavailable, relativeAgo, resolveSelected, totalTokens } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useContextDocs(repoId);
  const refreshRepo = useRefreshRepo();
  const [picked, setPicked] = React.useState<string | null>(null);

  const docs = React.useMemo(() => data?.docs ?? [], [data]);
  const roots = data?.roots ?? [];
  const selected = resolveSelected(docs, picked);
  const selectedDoc = docs.find((d) => d.path === selected) ?? null;
  const preview = useContextDoc(repoId, selected);

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [{ label: repoName, mono: true }, { label: t("title") }];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const notCloned = isError && isContextUnavailable(error);

  let main: React.ReactNode;
  if (isLoading) {
    main = (
      <div style={s.skeletons} data-testid="context-skeleton">
        <Skeleton height={28} />
        <Skeleton height={180} />
      </div>
    );
  } else if (notCloned) {
    main = (
      <EmptyState
        icon="GitBranch"
        title={t("notCloned.title")}
        body={t("notCloned.body")}
        cta={t("notCloned.sync")}
        ctaLoading={refreshRepo.isPending}
        onCta={() => refreshRepo.mutate(repoId, { onSuccess: () => void refetch() })}
      />
    );
  } else if (isError) {
    main = <ErrorState body={t("loadError")} onRetry={() => refetch()} />;
  } else if (docs.length === 0) {
    main = <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body", { globs: roots.join(", ") })} />;
  } else if (selectedDoc) {
    main = (
      <>
        <div style={s.mainHead}>
          <h2 className="mono" style={s.docName} title={selectedDoc.path}>
            {splitPath(selectedDoc.path).name}
          </h2>
          <Popover
            align="right"
            width={260}
            trigger={<span style={s.usedBy}>{t("usedBy.label", { count: selectedDoc.used_by_agents })}</span>}
            content={
              <div>
                <div style={s.popTitle}>{t("usedBy.title")}</div>
                <ul style={s.popList}>
                  {selectedDoc.used_by.map((a) => (
                    <li key={a.id}>{a.name}</li>
                  ))}
                </ul>
              </div>
            }
          />
        </div>
        {preview.isLoading && (
          <div style={s.skeletons}>
            <Skeleton height={180} />
          </div>
        )}
        {preview.isError && <p style={s.muted}>{t("previewLoadError")}</p>}
        {preview.data && (
          <div style={s.preview}>
            <Markdown>{preview.data.content}</Markdown>
          </div>
        )}
      </>
    );
  } else {
    main = <p style={s.muted}>{t("selectPrompt")}</p>;
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <aside style={s.side}>
          <div style={s.sideHead}>
            <div style={s.sideTitle}>{t("title")}</div>
            {roots.length > 0 && (
              <div className="mono" style={s.roots}>
                {roots.join(", ")}
              </div>
            )}
          </div>
          <div style={s.toolbar}>
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={isFetching && !isLoading}
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              {t("refresh")}
            </Button>
          </div>
          <div style={s.list}>
            {docs.length > 0 && <DocTree docs={docs} selected={selected} onSelect={setPicked} />}
          </div>
          {data && (
            <div style={s.footer}>
              <div>
                {t("footer.indexed", {
                  files: formatCount(docs.length),
                  tokens: formatCount(totalTokens(docs)),
                })}
              </div>
              <div>{t("footer.last", { relative: relativeAgo(dataUpdatedAt) })}</div>
            </div>
          )}
        </aside>
        <section style={s.main}>{main}</section>
      </div>
    </AppShell>
  );
}
