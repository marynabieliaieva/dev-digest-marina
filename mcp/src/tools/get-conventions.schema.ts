import { z } from 'zod';

export const getConventionsInput = z.object({
  repo: z.string().min(1).describe('Repository as owner/name (e.g. octocat/hello), or just the name if unambiguous.'),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe('concise (default): rule, file, confidence, accepted. detailed: also the evidence snippet.'),
});
export type GetConventionsInput = z.infer<typeof getConventionsInput>;
