import { z } from 'zod';

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().regex(HEX_COLOR, 'color must be a #RRGGBB hex value'),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export interface Tag {
  id: string;
  repoId: string;
  name: string;
  color: string;
  createdAt: Date;
}
