/** Constants for the conventions module. */

import type { ConventionCategory, Provider } from '@devdigest/shared';

export const EXTRACT_JOB_KIND = 'conventions-extract';

/** How many rank-ordered source files repo-intel samples for consideration. */
export const SAMPLE_FILE_COUNT = 12;

/** A sampled file's body is truncated to this many (1-based) lines before it
 *  ever reaches a prompt — keeps both token cost and citation range bounded. */
export const MAX_FILE_LINES = 300;

/** Token budget for the numbered SOURCE samples fed into call 2 (configs are
 *  small and always included on top of this). Code-only, no model involved. */
export const MAX_SAMPLE_TOKENS = 6_000;

/** At most this many source files survive Call 1 (file selection). */
export const MAX_SELECTED_FILES = 8;

/**
 * Fixed allowlist read straight off the clone root — `*` matches any suffix.
 * `package.json` is special-cased in `pickConfigFiles` (scripts + deps only,
 * never the whole file).
 */
export const CONFIG_ALLOWLIST = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.json',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  '.editorconfig',
  'package.json',
  'CLAUDE.md',
  'AGENTS.md',
] as const;

/** `getFeatureModelOverride(container, ws, 'conventions') ?? DEFAULT_MODEL`. */
export const DEFAULT_MODEL: { provider: Provider; model: string } = {
  provider: 'openai',
  model: 'gpt-5.4',
};

/** A cited snippet must land within this many lines of the cited line
 *  (after whitespace normalisation) to survive grounding. */
export const EVIDENCE_LINE_TOLERANCE = 3;

/** A rule longer than this is prose, not a citable convention. */
export const MAX_RULE_CHARS = 240;

/** Fixed taxonomy the extraction prompt is asked to fill 1-3 rules per. */
export const CATEGORIES: readonly ConventionCategory[] = [
  'naming',
  'error_handling',
  'module_structure',
  'async_style',
  'imports',
  'validation',
  'logging',
  'testing',
];
