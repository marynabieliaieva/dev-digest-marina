import type { DigestNotifier } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { TeamsWebhookNotifier } from '../adapters/teams/webhook.js';

export interface ContainerOverrides {
  notifier?: DigestNotifier | null;
}

export class Container {
  private _notifier?: DigestNotifier | null;

  constructor(
    readonly db: Db,
    private readonly overrides: ContainerOverrides = {},
  ) {}

  /** Digest notifier port, or null when TEAMS_WEBHOOK_URL is not configured. */
  async notifier(): Promise<DigestNotifier | null> {
    if (this.overrides.notifier !== undefined) return this.overrides.notifier;
    if (this._notifier !== undefined) return this._notifier;
    const url = process.env.TEAMS_WEBHOOK_URL;
    this._notifier = url ? new TeamsWebhookNotifier(url) : null;
    return this._notifier;
  }
}
