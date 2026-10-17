import type { NotificationClient } from '@devdigest/shared';

/** Slack incoming-webhook implementation of the NotificationClient port. */
export class SlackWebhookNotificationClient implements NotificationClient {
  constructor(private readonly webhookUrl: string) {}

  async postMessage(text: string): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook responded ${res.status}`);
    }
  }
}
