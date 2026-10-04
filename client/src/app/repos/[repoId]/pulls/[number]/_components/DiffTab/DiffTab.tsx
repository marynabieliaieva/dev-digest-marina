"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import {
  DiffViewer,
  type DiffCommentApi,
  type DiffFinding,
  type DiffFindingApi,
} from "@/components/diff-viewer";
import {
  usePrComments,
  useCreatePrComment,
  usePrReviews,
  usePrRuns,
  useSmartDiff,
  useFindingAction,
} from "@/lib/hooks/reviews";
import { RunCostBadge } from "@/components/run-cost-badge";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { SmartDiffGroup } from "../SmartDiffGroup";
import { filesForGroup, findingsByPath, selectLatestFindings, selectLatestRunUsage, severityCounts } from "./helpers";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}

type Order = "smart" | "original";

export function DiffTab({ prId, filesCount, files, canComment, repoFullName, headSha }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const { data: reviews } = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);
  const { data: smartDiff } = useSmartDiff(prId);
  const create = useCreatePrComment(prId);
  const findingAction = useFindingAction();
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  // undefined = untouched: findings default to visible, GitHub comments to hidden.
  const [showOverride, setShowOverride] = React.useState<boolean | undefined>(undefined);
  const [order, setOrder] = React.useState<Order>("original");

  const commentCount = comments?.length ?? 0;
  const findings = React.useMemo(() => selectLatestFindings(reviews ?? []), [reviews]);
  const byId = React.useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const byPath = React.useMemo(() => findingsByPath(findings), [findings]);
  const usage = React.useMemo(() => selectLatestRunUsage(runs ?? []), [runs]);
  const hasReview = (reviews ?? []).some((r) => r.kind === "review");
  // One effective state drives the label, the next click, findings AND (after a click) comments.
  const effectiveShow = showOverride ?? findings.length > 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments: showOverride ?? false,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowOverride(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const findingApi: DiffFindingApi = {
    byPath,
    show: effectiveShow,
    renderFinding: (d: DiffFinding) => {
      const rec = byId.get(d.id);
      if (!rec) return null;
      return (
        <FindingCard
          f={rec}
          defaultExpanded
          pending={findingAction.isPending}
          repoFullName={repoFullName}
          headSha={headSha}
          onAction={(action) =>
            findingAction.mutate({ findingId: rec.id, action, ...(prId ? { prId } : {}) })
          }
        />
      );
    },
  };

  const filesByPath = new Map(files.map((f) => [f.path, f]));
  const groups = order === "smart" && smartDiff?.groups.length ? smartDiff.groups : null;
  // PR files no group lists (smart-diff can lag the PR detail) still render, under core.
  const listed = new Set((smartDiff?.groups ?? []).flatMap((g) => g.files.map((f) => f.path)));
  const unlisted = files.filter((f) => !listed.has(f.path));
  const totalAdd = files.reduce((n, f) => n + f.additions, 0);
  const totalDel = files.reduce((n, f) => n + f.deletions, 0);
  // The button label counts what its noun names: findings when there are any (the toggle still
  // flips GitHub comments too), otherwise just the comments.
  const toggleCount = findings.length > 0 ? findings.length : commentCount;
  const toggleNoun = findings.length > 0 ? "findings" : "comments";

  return (
    <section>
      <SectionLabel icon="Code">Files changed · {filesCount} files</SectionLabel>

      <div style={s.bar}>
        <span style={s.heading}>
          {t(order === "smart" ? "smartDiff.reviewerOrdered" : "smartDiff.originalOrdered")}
        </span>
        <span className="mono" style={s.stat}>
          {t("smartDiff.filesCount", { count: files.length })} · +{totalAdd} −{totalDel}
        </span>
        <div style={s.segmented}>
          <Button
            kind={order === "smart" ? "secondary" : "ghost"}
            size="sm"
            active={order === "smart"}
            aria-pressed={order === "smart"}
            onClick={() => setOrder("smart")}
          >
            {t("smartDiff.smartOrder")}
          </Button>
          <Button
            kind={order === "original" ? "secondary" : "ghost"}
            size="sm"
            active={order === "original"}
            aria-pressed={order === "original"}
            onClick={() => setOrder("original")}
          >
            {t("smartDiff.originalOrder")}
          </Button>
        </div>
        {toggleCount > 0 && (
          <Button
            kind="ghost"
            size="sm"
            icon={effectiveShow ? "EyeOff" : "Eye"}
            onClick={() => setShowOverride(!effectiveShow)}
          >
            {effectiveShow ? "Hide" : "Show"} {toggleNoun} ({toggleCount})
          </Button>
        )}
      </div>

      {usage && (
        <p data-testid="review-token-usage" style={s.usage}>
          {t("smartDiff.tokensSpent")}:{" "}
          <RunCostBadge variant="detailed" costUsd={usage.costUsd} tokensIn={usage.tokensIn} tokensOut={usage.tokensOut} />
          {usage.runs > 1 ? ` · ${t("smartDiff.agentsCount", { count: usage.runs })}` : ""}
        </p>
      )}

      {groups && !hasReview && <p style={s.noReview}>{t("smartDiff.noReviewYet")}</p>}

      {groups ? (
        <div style={s.groups}>
          {groups.map((g) => (
            <SmartDiffGroup
              key={g.role}
              role={g.role}
              files={filesForGroup(g.role, g.files, filesByPath, unlisted)}
              severityCounts={severityCounts(g.files.map((f) => f.path), byPath)}
              hasReview={hasReview}
              commenting={commenting}
              findings={findingApi}
            />
          ))}
        </div>
      ) : (
        <DiffViewer files={files} commenting={commenting} findings={findingApi} />
      )}
    </section>
  );
}
