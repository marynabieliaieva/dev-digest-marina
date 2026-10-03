"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  repoId: string;
  repoFullName: string | null;
  headSha: string;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, repoId, repoFullName, headSha, prBody }: OverviewTabProps) {
  return (
    <>
      <IntentCard prId={prId} />
      <BlastRadiusCard prId={prId} repoId={repoId} repoFullName={repoFullName} headSha={headSha} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
