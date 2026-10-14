import type {
  GitHubClient,
  SecretsProvider,
  LLMProvider,
  NotificationClient,
} from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { SlackWebhookNotificationClient } from '../adapters/notifications/slack.js';

export interface ContainerOverrides {
  secrets?: SecretsProvider;
  github?: GitHubClient;
  llm?: LLMProvider;
  notifications?: NotificationClient;
}

export class Container {
  private _github?: GitHubClient;
  private _llm?: LLMProvider;
  private _notifications?: NotificationClient;
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

  /**
   * Async because the webhook URL comes from the secrets provider.
   * Returns null when SLACK_WEBHOOK_URL is not configured (notifications are optional).
   */
  async notifications(): Promise<NotificationClient | null> {
    if (this.overrides.notifications) return this.overrides.notifications;
    if (this._notifications) return this._notifications;
    const url = await this.secrets.get('SLACK_WEBHOOK_URL');
    if (!url) return null;
    this._notifications = new SlackWebhookNotificationClient(url);
    return this._notifications;
  }
}
