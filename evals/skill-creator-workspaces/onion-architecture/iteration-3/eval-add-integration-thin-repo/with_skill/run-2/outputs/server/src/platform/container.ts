import type { Db } from '../db/client.js';
import type { DigestNotifier } from '@devdigest/shared';
import { TeamsDigestNotifier } from '../adapters/teams/teams-notifier.js';

/** Test injection point: services depend on these interfaces, not the concrete classes. */
export interface ContainerOverrides {
  digestNotifier?: DigestNotifier | null;
}

export class Container {
  private _digestNotifier?: DigestNotifier | null;

  constructor(
    readonly db: Db,
    private readonly overrides: ContainerOverrides = {},
  ) {}

  /** Returns null when TEAMS_WEBHOOK_URL is not configured (notifications disabled). */
  digestNotifier(): DigestNotifier | null {
    if (this.overrides.digestNotifier !== undefined) return this.overrides.digestNotifier;
    if (this._digestNotifier !== undefined) return this._digestNotifier;
    const url = process.env.TEAMS_WEBHOOK_URL;
    this._digestNotifier = url ? new TeamsDigestNotifier(url) : null;
    return this._digestNotifier;
  }
}
