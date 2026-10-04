/** Max linked sources processed per PR (extras are recorded as `skipped`). */
export const MAX_LINKS = 5;
/** Extra `skipped` entries recorded beyond MAX_LINKS (bounds the stored list). */
export const MAX_SKIPPED_RECORDED = 10;
export const MAX_DOC_CHARS = 6000;
export const MAX_DOCS_TOTAL_CHARS = 18000;
export const MAX_TITLE_CHARS = 300;
export const MAX_BODY_CHARS = 4000;
export const MAX_REASON_CHARS = 300;

/** Hosts that need an authenticated integration — never fetched; matched as a suffix. */
export const AUTH_REQUIRED_HOSTS = [
  'atlassian.net',
  'linear.app',
  'notion.so',
  'notion.site',
  'docs.google.com',
] as const;

export const INTENT_SCHEMA_NAME = 'IntentClassification';

/** Repo-relative plan/spec/doc path directories recognised in a PR body. */
export const DOC_DIR_PATTERN = '(?:docs|plans?|specs?|rfcs?|adr)';
