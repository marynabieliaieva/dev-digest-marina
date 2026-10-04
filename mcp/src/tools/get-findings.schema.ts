import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from '../format/findings.js';

export const GetFindingsInput = z.object({
  run_id: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Run id from devdigest_run_agent_on_pr. Prefer this when you have it.'),
  repo: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Alternative to run_id: repository as owner/name; returns the latest review.'),
  pr: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Pull request number (e.g. 42), used with repo.'),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe(
      'concise (default): severity, title, file:line, rationale. detailed: also suggestion, confidence, ids, line range.',
    ),
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']).optional().describe('Only findings of this severity.'),
  file: z.string().max(300).optional().describe('Only findings whose file path contains this text.'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
export type GetFindingsArgs = z.infer<typeof GetFindingsInput>;

export const GET_FINDINGS_DESCRIPTION =
  "Get all reviews of a pull request in one call: an overview (reviews, total_findings, severity counts), then one section per reviewer agent with verdict, score and findings. Provide run_id (the PR's other agents are included too), or repo + pr. Concise by default; response_format:'detailed' for full fields; offset/limit page each agent's findings.";
