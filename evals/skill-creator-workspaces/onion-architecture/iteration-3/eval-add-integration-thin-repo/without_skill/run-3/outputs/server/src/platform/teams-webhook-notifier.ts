import type { Digest } from '@devdigest/shared';
import type { DigestNotifier } from '../modules/digests/ports.js';

/** Posts digests to a Microsoft Teams incoming webhook. */
export class TeamsWebhookNotifier implements DigestNotifier {
  constructor(private readonly webhookUrl: string) {}

  async notify(digest: Digest): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: `Digest for ${digest.repoId}`,
        title: `Digest for ${digest.repoId}`,
        text: digest.body.replace(/\n/g, '\n\n'),
      }),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }
}

/** No-op used when TEAMS_WEBHOOK_URL is not set. */
export class NoopNotifier implements DigestNotifier {
  async notify(): Promise<void> {}
}
