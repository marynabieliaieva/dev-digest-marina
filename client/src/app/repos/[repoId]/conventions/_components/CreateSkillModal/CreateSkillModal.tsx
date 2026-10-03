/* CreateSkillModal — merge accepted conventions into one skill. Loads a draft
   via skill-preview (persists NOTHING), lets the user fully edit it, then
   saves through the normal skill-create path — same preview → confirm split
   as the skill import flow. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useToast } from "@/lib/toast";
import { useConventionSkillPreview, useCreateSkillFromConventions } from "@/lib/hooks/conventions";
import { BODY_ROWS, MODAL_WIDTH, TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  candidateIds,
  onClose,
}: {
  repoId: string;
  candidateIds: string[];
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const tSkills = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const preview = useConventionSkillPreview(repoId);
  const create = useCreateSkillFromConventions(repoId);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("convention");
  const [body, setBody] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // No "call once" ref guard: skill-preview persists NOTHING (a pure draft
  // read), so React 18/19 Strict Mode's dev-only double effect-invoke is
  // harmless here — and a guard that survives the mount→cleanup→mount cycle
  // would instead break it: the first (cleaned-up) invocation's mutate() is
  // the only one that runs, but only the second (really-mounted) instance's
  // state updates are still live, so its onSuccess/onError never lands.
  React.useEffect(() => {
    preview.mutate(candidateIds, {
      onSuccess: (draft) => {
        setName(draft.name);
        setDescription(draft.description);
        setType(draft.type);
        setBody(draft.body);
      },
      onError: (err) => setError((err as Error).message),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave = name.trim().length > 0 && body.trim().length > 0 && !create.isPending && !preview.isPending;

  const submit = async () => {
    setError(null);
    try {
      const skill: Skill = await create.mutateAsync({
        name: name.trim(),
        description,
        type,
        body,
        enabled,
        candidateIds,
      });
      toast.success(t("modal.footerSaved"));
      onClose();
      router.push(`/skills/${skill.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={t("modal.mergedFrom", { count: candidateIds.length })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error ? <span style={s.error}>{error}</span> : <span style={s.footerNote}>{t("modal.footerSaved")}</span>}
          <Button kind="ghost" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Check" onClick={submit} disabled={!canSave}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      {preview.isPending ? (
        <div style={s.loading}>{tSkills("editor.subtitle")}</div>
      ) : (
        <div style={s.body}>
          <FormField label={t("modal.fields.name")} required>
            <TextInput value={name} onChange={setName} mono />
          </FormField>

          <FormField label={t("modal.fields.description")}>
            <TextInput value={description} onChange={setDescription} />
          </FormField>

          <FormField label={t("modal.fields.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as SkillType)}
              options={TYPE_OPTIONS.map((value) => ({ value, label: value }))}
            />
          </FormField>

          <FormField label={t("modal.fields.enabled")}>
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>

          <FormField
            label={t("modal.fields.body")}
            right={
              preview.data && (
                <span style={s.tokenCount}>
                  {t("modal.tokenCount", { count: preview.data.token_count })}
                </span>
              )
            }
            required
          >
            <Textarea value={body} onChange={setBody} rows={BODY_ROWS} mono />
          </FormField>
        </div>
      )}
    </Modal>
  );
}
