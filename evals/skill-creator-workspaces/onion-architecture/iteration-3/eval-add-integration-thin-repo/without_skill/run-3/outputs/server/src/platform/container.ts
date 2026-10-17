import type { Db } from '../db/client.js';
import type { DigestNotifier } from '../modules/digests/ports.js';
import { NoopNotifier, TeamsWebhookNotifier } from './teams-webhook-notifier.js';

export class Container {
  readonly digestNotifier: DigestNotifier;

  constructor(
    readonly db: Db,
    digestNotifier?: DigestNotifier,
  ) {
    const url = process.env.TEAMS_WEBHOOK_URL;
    this.digestNotifier =
      digestNotifier ?? (url ? new TeamsWebhookNotifier(url) : new NoopNotifier());
  }
}
