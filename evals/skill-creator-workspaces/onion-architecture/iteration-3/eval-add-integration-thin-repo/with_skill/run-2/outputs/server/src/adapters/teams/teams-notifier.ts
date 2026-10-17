import type { DigestNotifier } from '@devdigest/shared';

/** Microsoft Teams incoming-webhook implementation of DigestNotifier. Only file that knows Teams. */
export class TeamsDigestNotifier implements DigestNotifier {
  constructor(private readonly webhookUrl: string) {}

  async postDigest(title: string, body: string): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, text: body }),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }
}
