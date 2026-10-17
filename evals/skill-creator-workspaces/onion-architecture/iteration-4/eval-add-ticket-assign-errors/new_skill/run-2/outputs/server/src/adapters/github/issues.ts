import { Octokit } from 'octokit';
import type { IssueTracker } from '@devdigest/shared';
import { ExternalServiceError } from '../../platform/errors.js';

export class OctokitIssueTracker implements IssueTracker {
  private readonly octokit: Octokit;

  constructor(token: string, private readonly owner: string, private readonly repo: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async close(issueNumber: number): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: 'closed',
    });
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
      // Wrap the vendor exception so no Octokit type leaks; the error handler maps this to 502.
      throw new ExternalServiceError('GitHub assign failed', { cause: String(err) });
    }
  }
}
