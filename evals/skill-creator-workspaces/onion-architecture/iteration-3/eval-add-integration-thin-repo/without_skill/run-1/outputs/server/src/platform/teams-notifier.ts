import type { Digest } from '@devdigest/shared';
import type { DigestNotifier } from '../modules/digests/ports.js';

/** Adapter: posts a digest to a Microsoft Teams incoming webhook. */
export class TeamsWebhookNotifier implements DigestNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async notify(digest: Digest): Promise<void> {
    const res = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: 'Digest',
        title: `Digest for ${digest.repoId}`,
        text: digest.body.replace(/\n/g, '\n\n'),
      }),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }
}

export class NoopNotifier implements DigestNotifier {
  async notify(): Promise<void> {}
}
