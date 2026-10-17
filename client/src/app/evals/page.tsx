/* /evals — workspace Eval Dashboard (L06). Thin shell; the view lives in _components. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { EvalDashboardView } from "./_components/EvalDashboardView";

export default function EvalsPage() {
  const t = useTranslations("eval.page");
  return (
    <AppShell crumb={[{ label: t("crumbSkillsLab") }, { label: t("crumbEvalDashboard") }]}>
      <EvalDashboardView />
    </AppShell>
  );
}
