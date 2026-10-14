import { z } from 'zod';

export const ReportFormat = z.enum(['csv', 'pdf']);
export type ReportFormat = z.infer<typeof ReportFormat>;

export const Report = z.object({
  id: z.string(),
  repoId: z.string(),
  title: z.string(),
  format: ReportFormat,
  exportedUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type Report = z.infer<typeof Report>;

export const CreateReportBody = z.object({
  repoId: z.string(),
  title: z.string().min(1),
  format: ReportFormat,
});
export type CreateReportBody = z.infer<typeof CreateReportBody>;
