import { Octokit } from 'octokit';
import type { GitHubClient, PullRequestRef } from '@devdigest/shared';

export class OctokitGitHubClient implements GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getPullRequestDiff(ref: PullRequestRef): Promise<string> {
    const res = await this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      mediaType: { format: 'diff' },
    });
    return res.data as unknown as string;
  }

  async postComment(ref: PullRequestRef, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.number,
      body,
    });
  }
}
