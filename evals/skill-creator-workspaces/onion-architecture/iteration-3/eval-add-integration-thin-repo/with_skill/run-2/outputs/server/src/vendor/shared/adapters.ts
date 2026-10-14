// Ports (interfaces only, no I/O). Services depend on these, never on concrete adapters.
// NOTE: re-export this file from the @devdigest/shared barrel if it is not already.

export interface DigestNotifier {
  /** Post a finished digest to an external chat channel. */
  postDigest(title: string, body: string): Promise<void>;
}
