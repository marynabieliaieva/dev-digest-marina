import type { IssueTracker } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { OctokitIssueTracker } from '../adapters/github/issues.js';

export interface ContainerOverrides {
  issues?: IssueTracker;
}

export class Container {
  private _issues?: IssueTracker;

  constructor(readonly db: Db, private readonly overrides: ContainerOverrides = {}) {}

  get issues(): IssueTracker {
    if (this.overrides.issues) return this.overrides.issues;
    this._issues ??= new OctokitIssueTracker(
      process.env.GITHUB_TOKEN ?? '',
      process.env.GITHUB_OWNER ?? '',
      process.env.GITHUB_REPO ?? '',
    );
    return this._issues;
  }
}
