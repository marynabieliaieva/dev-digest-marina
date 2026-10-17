import { z } from 'zod';
import { summaryCacheKey } from '../../../modules/summaries/helpers.js';

export const Summary = z.object({
  id: z.string(),
  prId: z.string(),
  text: z.string(),
  model: z.string(),
  createdAt: z.string(),
});
export type Summary = z.infer<typeof Summary>;

export const SummaryRequest = z.object({
  prId: z.string(),
  maxWords: z.number().int().min(20).max(400).default(120),
});
export type SummaryRequest = z.infer<typeof SummaryRequest>;

export const cacheKeyFor = (req: SummaryRequest) => summaryCacheKey(req.prId, req.maxWords);
