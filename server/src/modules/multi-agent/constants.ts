import type { Severity } from '@devdigest/shared';

/** Findings within this many lines of a group's furthest end line join the group. */
export const GROUP_LINE_TOLERANCE = 3;
/** Most agents one multi-agent run may fan out to. */
export const MAX_AGENTS = 5;
/** How many recent `done` runs feed an agent's duration/cost estimate. */
export const ESTIMATE_SAMPLE = 10;

/** Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

export const DID_NOT_FLAG_NOTE = 'Did not flag this';
export const FAILED_NOTE = 'Run failed';
export const CANCELLED_NOTE = 'Run was cancelled';

export const MULTI_AGENT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
