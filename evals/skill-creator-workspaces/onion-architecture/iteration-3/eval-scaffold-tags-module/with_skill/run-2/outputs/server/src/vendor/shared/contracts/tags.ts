import { z } from 'zod';

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const TagSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  name: z.string().min(1).max(50),
  color: z.string().regex(HEX_COLOR_RE),
  createdAt: z.string().datetime(),
});
export type Tag = z.infer<typeof TagSchema>;

export const CreateTagInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(HEX_COLOR_RE, 'color must be a #rrggbb hex value'),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;
