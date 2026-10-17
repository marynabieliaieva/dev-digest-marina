import type { GitHubClient, SecretsProvider, LLMProvider } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';

export interface ContainerOverrides {
  secrets?: SecretsProvider;
  github?: GitHubClient;
  llm?: LLMProvider;
}

export class Container {
  private _github?: GitHubClient;
  private _llm?: LLMProvider;
  readonly secrets: SecretsProvider;

  constructor(readonly db: Db, private readonly overrides: ContainerOverrides = {}) {
    this.secrets = overrides.secrets ?? new LocalSecretsProvider();
  }

  get github(): GitHubClient {
    if (this.overrides.github) return this.overrides.github;
    this._github ??= new OctokitGitHubClient(process.env.GITHUB_TOKEN ?? '');
    return this._github;
  }

  get llm(): LLMProvider {
    if (this.overrides.llm) return this.overrides.llm;
    this._llm ??= new OpenAIProvider(process.env.OPENAI_API_KEY ?? '');
    return this._llm;
  }
}
