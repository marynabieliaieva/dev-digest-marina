import type { Digest } from '@devdigest/shared';

/** Port: publishes a generated digest to an external chat/notification system. */
export interface DigestNotifier {
  notify(digest: Digest): Promise<void>;
}
