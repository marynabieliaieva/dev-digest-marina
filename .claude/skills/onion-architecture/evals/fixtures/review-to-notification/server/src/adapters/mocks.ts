import type { GitHubClient, SecretsProvider, LLMProvider, PullRequestRef } from '@devdigest/shared';

export class MockGitHubClient implements GitHubClient {
  readonly comments: string[] = [];
  async getPullRequestDiff(_ref: PullRequestRef): Promise<string> {
    return 'diff --git a/a.ts b/a.ts';
  }
  async postComment(_ref: PullRequestRef, body: string): Promise<void> {
    this.comments.push(body);
  }
}

export class MockSecretsProvider implements SecretsProvider {
  constructor(private readonly values: Record<string, string> = {}) {}
  async get(name: string): Promise<string | null> {
    return this.values[name] ?? null;
  }
}

export class MockLLMProvider implements LLMProvider {
  async complete(_prompt: string): Promise<string> {
    return 'ok';
  }
}
