import type { Digest } from '@devdigest/shared';

/** Port: announces a freshly generated digest to an external channel. */
export interface DigestNotifier {
  notify(digest: Digest): Promise<void>;
}
