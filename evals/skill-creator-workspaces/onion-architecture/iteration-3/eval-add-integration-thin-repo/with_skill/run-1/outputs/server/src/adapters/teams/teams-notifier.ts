import type { DigestNotifier } from '@devdigest/shared';

/** Infrastructure: the only file that knows about the Teams incoming-webhook wire format. */
export class TeamsDigestNotifier implements DigestNotifier {
  constructor(private readonly webhookUrl: string) {}

  async notifyDigest(title: string, body: string): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, text: body }),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }
}
