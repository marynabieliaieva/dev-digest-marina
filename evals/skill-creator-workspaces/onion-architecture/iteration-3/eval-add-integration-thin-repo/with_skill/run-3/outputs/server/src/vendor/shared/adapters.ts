// NEW port (fixture had no adapters.ts). If a real adapters.ts exists, append this
// interface to it and re-export it from the shared package index.

export interface DigestNotifier {
  /** Post a digest to an external chat channel. Rejects on transport failure. */
  post(title: string, text: string): Promise<void>;
}
