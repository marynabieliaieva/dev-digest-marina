import type { DigestNotifier } from '@devdigest/shared';

// Infrastructure: the only file that knows about the Teams incoming-webhook protocol.
export class TeamsWebhookNotifier implements DigestNotifier {
  constructor(private readonly webhookUrl: string) {}

  async post(title: string, text: string): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, text }),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }
}
