import { z } from 'zod';

export const repoParams = z.object({ repoId: z.string().uuid() });
export const tagParams = z.object({ repoId: z.string().uuid(), tagId: z.string().uuid() });

export const createTagBody = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #rrggbb hex value'),
});
