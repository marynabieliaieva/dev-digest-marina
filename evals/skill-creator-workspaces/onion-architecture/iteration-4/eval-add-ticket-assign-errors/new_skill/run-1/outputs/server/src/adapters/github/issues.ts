import { Octokit } from 'octokit';
import type { IssueTracker } from '@devdigest/shared';
import { ExternalServiceError } from '../../platform/errors.js';

export class OctokitIssueTracker implements IssueTracker {
  private readonly octokit: Octokit;

  constructor(token: string, private readonly owner: string, private readonly repo: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async close(issueNumber: number): Promise<void> {
    try {
      await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        state: 'closed',
      });
    } catch (err) {
      throw new ExternalServiceError('GitHub: failed to close issue', { cause: String(err) });
    }
  }

  async assign(issueNumber: number, assignee: string): Promise<void> {
    try {
      await this.octokit.rest.issues.addAssignees({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        assignees: [assignee],
      });
    } catch (err) {
      throw new ExternalServiceError('GitHub: failed to assign issue', { cause: String(err) });
    }
  }
}
