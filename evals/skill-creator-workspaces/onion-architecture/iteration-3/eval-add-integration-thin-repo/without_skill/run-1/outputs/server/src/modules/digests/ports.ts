import type { Digest } from '@devdigest/shared';

/** Port: delivers a generated digest to some external channel. */
export interface DigestNotifier {
  notify(digest: Digest): Promise<void>;
}
