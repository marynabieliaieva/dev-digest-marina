import { z } from 'zod';

export const Invoice = z.object({
  id: z.string(),
  customerEmail: z.string().email(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paidAt: z.string().nullable(),
});
export type Invoice = z.infer<typeof Invoice>;

export const CreateInvoiceBody = z.object({
  customerEmail: z.string().email(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
});
export type CreateInvoiceBody = z.infer<typeof CreateInvoiceBody>;
