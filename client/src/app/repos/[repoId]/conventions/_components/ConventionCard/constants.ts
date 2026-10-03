import type { ConventionCategory } from "@devdigest/shared";

/** Mirrors the server's CATEGORY_LABELS (modules/conventions/helpers.ts) — UI
    text only, so no cross-package import. */
export const CATEGORY_LABELS: Record<ConventionCategory, string> = {
  naming: "Naming",
  error_handling: "Error handling",
  module_structure: "Module structure",
  async_style: "Async style",
  imports: "Imports",
  validation: "Validation",
  logging: "Logging",
  testing: "Testing",
  other: "Other",
};

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MID = 0.7;
