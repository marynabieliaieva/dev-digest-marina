export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubClient {
  getPullRequestDiff(ref: PullRequestRef): Promise<string>;
  postComment(ref: PullRequestRef, body: string): Promise<void>;
}

export interface SecretsProvider {
  get(name: string): Promise<string | null>;
}

export interface LLMProvider {
  complete(prompt: string): Promise<string>;
}
