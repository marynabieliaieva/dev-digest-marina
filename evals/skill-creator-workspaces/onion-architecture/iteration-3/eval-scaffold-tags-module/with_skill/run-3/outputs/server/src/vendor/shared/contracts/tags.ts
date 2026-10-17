import { z } from 'zod';

export const TagColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #RRGGBB hex value');

export const Tag = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: TagColor,
  createdAt: z.string(),
});
export type Tag = z.infer<typeof Tag>;

export const CreateTagInput = z.object({
  name: z.string().trim().min(1).max(50),
  color: TagColor,
});
export type CreateTagInput = z.infer<typeof CreateTagInput>;
