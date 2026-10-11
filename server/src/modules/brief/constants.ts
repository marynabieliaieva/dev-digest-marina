/** Log `call` tag shared by the before/after entries. */
export const BRIEF_CALL = 'pr_brief';

/** POST /pulls/:id/brief rate limit (mirrors the intent derive route). */
export const BRIEF_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
