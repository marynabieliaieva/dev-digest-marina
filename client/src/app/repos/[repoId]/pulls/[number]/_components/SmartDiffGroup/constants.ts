import type { SmartDiffRole } from "@devdigest/shared";

/** Groups that start collapsed — rarely worth a reviewer's first look. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<SmartDiffRole> = new Set(["docs", "boilerplate"]);

export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent, #6366f1)",
  tests: "var(--success, #22c55e)",
  wiring: "var(--warning, #f59e0b)",
  docs: "var(--text-muted, #94a3b8)",
  boilerplate: "var(--border-strong, #64748b)",
};

/** i18n keys (under `smartDiff.`) per role. */
export const ROLE_LABEL_KEY = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
} as const satisfies Record<SmartDiffRole, string>;

export const ROLE_DESC_KEY = {
  core: "coreDesc",
  tests: "testsDesc",
  wiring: "wiringDesc",
  docs: "docsDesc",
  boilerplate: "boilerplateDesc",
} as const satisfies Record<SmartDiffRole, string>;

/** Group-header finding chips: severity → reviewer-facing word (colour + icon come from SEV) (CRITICAL reads as "blocker"). */
export const SEVERITY_CHIPS = [
  { severity: "CRITICAL", word: "blocker" },
  { severity: "WARNING", word: "warning" },
  { severity: "SUGGESTION", word: "suggestion" },
] as const;
