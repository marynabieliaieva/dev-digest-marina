/** Hard ceiling for the whole brief prompt (system + user), estimated as ceil(chars / 4). */
export const BRIEF_TOKEN_BUDGET = 8000;

/** Tokens held back up front for the data-gaps note, which is rendered after the budget pass. */
export const GAP_NOTE_RESERVE_TOKENS = 300;

/** Output cap for the single structured call. */
export const BRIEF_MAX_OUTPUT_TOKENS = 1500;

export const MAX_TITLE_CHARS = 300;
export const MAX_BODY_CHARS = 4000;
export const MAX_ISSUE_BODY_CHARS = 4000;
export const MAX_DIFF_FILES = 100;
export const MAX_BLAST_CALLERS = 50;

export const MAX_RISKS = 8;
export const MAX_REVIEW_FOCUS = 6;
