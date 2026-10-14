import { z } from 'zod';

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #RRGGBB hex value');

export const Tag = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  name: z.string(),
  color: HexColor,
  createdAt: z.string().datetime(),
});
export type Tag = z.infer<typeof Tag>;

export const CreateTagInput = z.object({
  name: z.string().trim().min(1).max(50),
  color: HexColor,
});
export type CreateTagInput = z.infer<typeof CreateTagInput>;

export const TagParams = z.object({ repoId: z.string().uuid() });
export const TagIdParams = z.object({ repoId: z.string().uuid(), tagId: z.string().uuid() });
