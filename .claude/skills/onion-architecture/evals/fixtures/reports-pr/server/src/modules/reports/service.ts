import type { GitHubClient, Report, CreateReportBody } from '@devdigest/shared';
import type { ReportExporter } from '../../adapters/s3/types.js';
import { NotFoundError } from '../../platform/errors.js';
import type { ReportRepository } from './repository.js';

export class ReportService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly exporter: ReportExporter,
    private readonly github: GitHubClient,
  ) {}

  async create(body: CreateReportBody): Promise<Report> {
    return this.repo.insert(body.repoId, body.title, body.format);
  }

  async export(id: string): Promise<Report> {
    const report = await this.repo.get(id);
    if (!report) throw new NotFoundError('report_not_found');

    const summary = await this.github.getRepositorySummary(report.repoId);
    const url = await this.exporter.upload({
      key: `reports/${report.id}.${report.format}`,
      contentType: report.format === 'pdf' ? 'application/pdf' : 'text/csv',
      body: new TextEncoder().encode(`${report.title}\n${summary}`),
    });

    const updated = await this.repo.setExportedUrl(id, url);
    if (!updated) throw new NotFoundError('report_not_found');
    return updated;
  }
}
