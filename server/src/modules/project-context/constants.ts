/** Default search globs for project context documents (repo-relative, forward slashes). */
export const DEFAULT_CONTEXT_GLOBS = ['**/{specs,docs,insights}/**/*.md'];

/** Documents larger than this are skipped, never truncated. */
export const MAX_DOC_BYTES = 65_536;

/** Per-run budget (estimated tokens) for injected project context. */
export const RUN_TOKEN_BUDGET = 20_000;

/** Directories never walked. */
export const EXCLUDED_DIRS = ['.git', 'node_modules'];

export const DOC_TYPES = ['specs', 'docs', 'insights'] as const;

export const MAX_ATTACHED_PATHS = 100;
export const MAX_PATH_LEN = 512;
