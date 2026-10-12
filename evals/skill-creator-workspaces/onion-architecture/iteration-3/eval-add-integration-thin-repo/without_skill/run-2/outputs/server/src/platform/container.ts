import type { Db } from '../db/client.js';
import type { DigestNotifier } from '../modules/digests/ports.js';
import { createTeamsNotifierFromEnv } from './teams-notifier.js';

export class Container {
  constructor(
    readonly db: Db,
    readonly digestNotifier: DigestNotifier | null = createTeamsNotifierFromEnv(),
  ) {}
}
