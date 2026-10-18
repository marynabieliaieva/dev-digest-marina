import type { Db } from '../db/client.js';
import type { DigestNotifier } from '../modules/digests/ports.js';
import { NoopNotifier, TeamsWebhookNotifier } from './teams-notifier.js';

export class Container {
  constructor(
    readonly db: Db,
    readonly digestNotifier: DigestNotifier = new NoopNotifier(),
  ) {}
}

/** Composition root: wires adapters from environment configuration. */
export function createContainer(db: Db, env: NodeJS.ProcessEnv = process.env): Container {
  const url = env.TEAMS_WEBHOOK_URL;
  return new Container(db, url ? new TeamsWebhookNotifier(url) : new NoopNotifier());
}
