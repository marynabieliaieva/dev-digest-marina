import { z } from 'zod';

export const BLAST_RADIUS_DESCRIPTION =
  'Before reviewing a PR, see which callers, endpoints and crons its changes can affect (from the prebuilt repo index). Requires both repo and pr.';

// Both are required in practice; kept optional here so the handler can answer
// with a next-step hint instead of an SDK validation error.
export const getBlastRadiusInput = z.object({
  repo: z.string().optional().describe('Required. Repository as owner/name (e.g. octocat/hello).'),
  pr: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('Required. Pull request number (e.g. 42), not an internal id.'),
});
export type GetBlastRadiusInput = z.infer<typeof getBlastRadiusInput>;
