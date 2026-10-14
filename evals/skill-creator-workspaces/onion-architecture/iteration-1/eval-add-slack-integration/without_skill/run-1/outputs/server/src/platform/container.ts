import type { GitHubClient, SecretsProvider, LLMProvider, Notifier } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { SlackWebhookNotifier } from '../adapters/slack/webhook.js';

export interface ContainerOverrides {
  secrets?: SecretsProvider;
  github?: GitHubClient;
  llm?: LLMProvider;
  notifier?: Notifier;
}

export class Container {
  private _github?: GitHubClient;
  private _llm?: LLMProvider;
  private _notifier?: Notifier;
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

  get notifier(): Notifier {
    if (this.overrides.notifier) return this.overrides.notifier;
    this._notifier ??= new SlackWebhookNotifier(this.secrets);
    return this._notifier;
  }
}
