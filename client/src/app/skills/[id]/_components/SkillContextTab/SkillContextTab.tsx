/* SkillContextTab — attach project documents to a skill; every agent using the
   skill inherits them. Saved immediately through its own endpoint, never via
   useUpdateSkill (that would bump the skill version). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { ContextDocPicker } from "@/components/context-doc-picker/ContextDocPicker";
import { useContextDocs, useSkillContext, useSetSkillContext } from "@/lib/hooks/project-context";
import { useActiveRepo } from "@/lib/repo-context";
import { serializePreview } from "./helpers";
import { s } from "./styles";

export function SkillContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { repoId, activeRepo } = useActiveRepo();
  const docs = useContextDocs(repoId);
  const attached = useSkillContext(skill.id);
  const setContext = useSetSkillContext(skill.id);
  const paths = attached.data?.paths ?? [];

  return (
    <div style={s.wrap}>
      <div>
        <h2 style={s.h2}>{t("contextTab.title")}</h2>
        <p style={s.subtitle}>{t("contextTab.subtitle")}</p>
      </div>
      <ContextDocPicker
        docs={docs.data?.docs}
        loading={docs.isLoading || attached.isLoading}
        error={docs.isError || attached.isError}
        attached={paths}
        onChange={(next) => setContext.mutate({ paths: next })}
        repoId={repoId ?? ""}
        repoName={activeRepo?.full_name ?? ""}
        badgeVariant="count"
      />
      <div>
        <div style={s.serializesLabel}>{t("contextTab.serializesAs")}</div>
        <pre className="mono" style={s.pre} data-testid="serialize-preview">
          {serializePreview(paths)}
        </pre>
      </div>
    </div>
  );
}
