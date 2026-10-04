import { z } from 'zod';
import { Verdict } from './findings.js';
import { FindingRecord } from './review-api.js';

/**
 * Review-by-reference contracts: address repos / PRs / runs by human-readable
 * refs (owner/name, PR number) instead of internal ids. Used by the
 * `GET /repos/resolve`, `POST /reviews/by-ref`, `GET /runs/:id` and
 * `GET /reviews/latest` routes (consumed by the local MCP server).
 */

/**
 * NOTE: named ResolvedRepoRef because `RepoRef` ({owner,name}) already exists in
 * adapters.ts and both are re-exported from the same barrel.
 * Result of resolving `owner/name` (or a bare name) to a devdigest repo. */
export const ResolvedRepoRef = z.object({
  id: z.string(),
  full_name: z.string(),
});
export type ResolvedRepoRef = z.infer<typeof ResolvedRepoRef>;

/** Result of `GET /pulls/resolve?repo=<ref>&pr=<n>`. */
export const ResolvedPullRef = z.object({ id: z.string() });
export type ResolvedPullRef = z.infer<typeof ResolvedPullRef>;

/** Lifecycle of an agent run. Moves forward only: running → done|failed|cancelled. */
export const RunStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

/** Body of `POST /reviews/by-ref`. Provide `agent` (id, or name as fallback) or `all:true`. */
export const ReviewByRefRequest = z.object({
  repo: z.string().min(1).max(200),
  pr: z.coerce.number().int().positive(),
  agent: z.string().min(1).max(200).optional(),
  all: z.boolean().optional(),
});
export type ReviewByRefRequest = z.infer<typeof ReviewByRefRequest>;

/** Response of `POST /reviews/by-ref`. `reused` = an active run for this PR+agent was returned. */
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

/** Response of `GET /runs/:id`. `review` is null until the run is `done`. */
export const RunDetail = z.object({
  run: z.object({
    run_id: z.string(),
    status: RunStatus,
    error: z.string().nullable(),
    agent_id: z.string().nullable(),
    agent_name: z.string().nullable(),
    model: z.string().nullable(),
    ran_at: z.string().nullable(),
    duration_ms: z.number().int().nullable(),
    pr_number: z.number().int().nullable(),
    repo_full_name: z.string().nullable(),
  }),
  review: z
    .object({
      verdict: Verdict.nullable(),
      score: z.number().int().nullable(),
      summary: z.string().nullable(),
      findings: z.array(FindingRecord),
    })
    .nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;
