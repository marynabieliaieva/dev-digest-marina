"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { ReviewRecord } from "@devdigest/shared";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard";
import { VerdictBanner } from "../VerdictBanner";
import { selectLatestVerdictReview, useMediaQuery } from "./helpers";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  repoId: string;
  repoFullName: string | null;
  headSha: string | undefined;
  prBody: string | null | undefined;
  prNumber: number | string;
  reviews: ReviewRecord[] | undefined;
  changedFiles: string[];
  onNavigate: (href: string) => void;
}

export function OverviewTab({
  prId,
  repoId,
  repoFullName,
  headSha,
  prBody,
  prNumber,
  reviews,
  changedFiles,
  onNavigate,
}: OverviewTabProps) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const verdict = selectLatestVerdictReview(reviews);
  return (
    <>
      {verdict && <VerdictBanner {...verdict} />}
      <PrBriefCard
        prId={prId}
        headSha={headSha}
        repoId={repoId}
        number={prNumber}
        changedFiles={changedFiles}
        onNavigate={onNavigate}
      />
      <div data-layout={wide ? "two-col" : "stacked"} style={s.cards(wide)}>
        <IntentCard prId={prId} />
        <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha ?? ""} />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
