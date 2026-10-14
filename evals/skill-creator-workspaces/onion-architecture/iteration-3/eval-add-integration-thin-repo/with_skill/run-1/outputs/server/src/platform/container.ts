import type { DigestNotifier } from '@devdigest/shared';
import type { Db } from '../db/client.js';
import { TeamsDigestNotifier } from '../adapters/teams/teams-notifier.js';

/** Test injection point: services depend on these interfaces, not the concrete classes. */
export interface ContainerOverrides {
  digestNotifier?: DigestNotifier;
}

export class Container {
  private _digestNotifier?: DigestNotifier;

  constructor(
    readonly db: Db,
    private readonly overrides: ContainerOverrides = {},
  ) {}

  /** Returns null when TEAMS_WEBHOOK_URL is not configured (posting is optional). */
  async digestNotifier(): Promise<DigestNotifier | null> {
    if (this.overrides.digestNotifier) return this.overrides.digestNotifier;
    if (this._digestNotifier) return this._digestNotifier;
    const url = process.env.TEAMS_WEBHOOK_URL;
    if (!url) return null;
    this._digestNotifier = new TeamsDigestNotifier(url);
    return this._digestNotifier;
  }
}
