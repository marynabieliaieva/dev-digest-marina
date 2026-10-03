import { z } from 'zod';

/**
 * Local zod-4 MIRRORS of the DevDigest API response contracts that this package
 * consumes. The source of truth is `server/src/vendor/shared/contracts/*`
 * (zod 3) — never import `@devdigest/shared` here (zod 3 vs 4 conflict). Kept
 * deliberately lenient: only the fields the MCP tools read; unknown keys are
 * stripped (so e.g. an agent's `system_prompt` can never reach tool output).
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

/** Moves forward only: running -> done | failed | cancelled. */
export const RunStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

// GET /repos/resolve (server contract name: ResolvedRepoRef)
export const ResolvedRepoRef = z.object({ id: z.string(), full_name: z.string() });
export type ResolvedRepoRef = z.infer<typeof ResolvedRepoRef>;

// GET /pulls/resolve (server contract name: ResolvedPullRef)
export const ResolvedPullRef = z.object({ id: z.string() });
export type ResolvedPullRef = z.infer<typeof ResolvedPullRef>;

// GET /pulls/:id/blast (server contract name: BlastRadiusResponse). Enum-like
// fields are plain strings so a future server enum value cannot break parsing.
export const BlastRadiusResponse = z.object({
  pr_id: z.string(),
  indexed_sha: z.string().nullable(),
  index_status: z.string(),
  degraded: z.boolean(),
  reason: z.string().nullable(),
  blast: z.object({
    changed_symbols: z.array(z.object({ name: z.string(), file: z.string(), kind: z.string() })),
    downstream: z.array(
      z.object({
        symbol: z.string(),
        callers: z.array(z.object({ name: z.string(), file: z.string(), line: z.number().int() })),
        endpoints_affected: z.array(z.string()),
        crons_affected: z.array(z.string()),
      }),
    ),
    summary: z.string(),
  }),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;

// GET /agents (items). system_prompt etc. intentionally not mirrored.
export const AgentSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  model: z.string(),
  enabled: z.boolean(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;
export const AgentList = z.array(AgentSummary);

// POST /reviews/by-ref request body
export interface ReviewByRefRequest {
  repo: string;
  pr: number;
  agent?: string | undefined;
  all?: boolean | undefined;
}

// POST /reviews/by-ref response
export const ReviewByRefResponse = z.object({
  pr: z.object({
    id: z.string(),
    number: z.number().int(),
    title: z.string(),
    repo_full_name: z.string(),
  }),
  runs: z.array(
    z.object({
      run_id: z.string(),
      agent_id: z.string(),
      agent_name: z.string(),
      reused: z.boolean(),
    }),
  ),
});
export type ReviewByRefResponse = z.infer<typeof ReviewByRefResponse>;

export const FindingRecord = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(),
  suggestion: z.string().nullish(),
  confidence: z.number(),
  review_id: z.string().optional(),
  accepted_at: z.string().nullish(),
  dismissed_at: z.string().nullish(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

// GET /runs/:id and items of GET /reviews/latest
export const RunDetail = z.object({
  run: z.object({
    run_id: z.string(),
    status: RunStatus,
    error: z.string().nullable(),
    agent_id: z.string().nullable(),
    agent_name: z.string().nullable(),
    model: z.string().nullable(),
    ran_at: z.string().nullable(),
    duration_ms: z.number().nullable(),
    pr_number: z.number().nullable(),
    repo_full_name: z.string().nullable(),
  }),
  review: z
    .object({
      verdict: Verdict.nullable(),
      score: z.number().nullable(),
      summary: z.string().nullable(),
      findings: z.array(FindingRecord),
    })
    .nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;
export const RunDetailList = z.array(RunDetail);

// GET /repos/:id/conventions
export const ConventionCandidate = z.object({
  id: z.string(),
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_line: z.number().int().nullable(),
  evidence_snippet: z.string(),
  confidence: z.number(),
  status: z.enum(['pending', 'accepted', 'rejected']),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionsPage = z.object({
  extraction: z
    .object({
      id: z.string(),
      status: z.enum(['running', 'done', 'failed']),
      sampled_files: z.number().int(),
      created_at: z.string(),
    })
    .nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsPage = z.infer<typeof ConventionsPage>;
