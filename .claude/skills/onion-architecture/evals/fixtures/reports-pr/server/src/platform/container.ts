import type { GitHubClient } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import type { ReportExporter } from '../adapters/s3/types.js';
import { S3ReportExporter } from '../adapters/s3/exporter.js';

export interface ContainerOverrides {
  github?: GitHubClient;
  exporter?: ReportExporter;
}

export class Container {
  private _github?: GitHubClient;
  private _exporter?: ReportExporter;

  constructor(readonly db: Db, private readonly overrides: ContainerOverrides = {}) {}

  get github(): GitHubClient {
    if (this.overrides.github) return this.overrides.github;
    this._github ??= new OctokitGitHubClient(process.env.GITHUB_TOKEN ?? '');
    return this._github;
  }

  get exporter(): ReportExporter {
    if (this.overrides.exporter) return this.overrides.exporter;
    this._exporter ??= new S3ReportExporter(process.env.REPORTS_BUCKET ?? '', process.env.AWS_REGION ?? 'eu-west-1');
    return this._exporter;
  }
}
