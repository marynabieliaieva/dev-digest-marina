import { z } from 'zod';

export const RunAgentOnPrInput = z.object({
  repo: z
    .string()
    .min(1)
    .max(200)
    .describe('Repository as owner/name (e.g. octocat/hello), or just the name if unambiguous.'),
  pr: z.coerce.number().int().positive().describe('Pull request number (e.g. 42), not an internal id.'),
  agent: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('Agent id from devdigest_list_agents. Do not guess — list agents first.'),
  all: z.boolean().optional().describe('Run all enabled agents instead of one.'),
});
export type RunAgentOnPrArgs = z.infer<typeof RunAgentOnPrInput>;

export const RUN_AGENT_ON_PR_DESCRIPTION =
  "Run one reviewer agent on a pull request and return the result. This is a single call that triggers the review, waits for it to finish, and returns the verdict and findings — you do not need to poll. Requires a valid agent id from devdigest_list_agents — do not guess it. If the review takes longer than ~2 min it returns {status:'running', run_id}; call devdigest_get_findings with that run_id later.";
