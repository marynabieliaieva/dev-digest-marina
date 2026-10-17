import type { Notifier, ReviewNotification, SecretsProvider } from '@devdigest/shared';

export const SLACK_WEBHOOK_SECRET_NAME = 'SLACK_WEBHOOK_URL';

export class SlackWebhookNotifier implements Notifier {
  constructor(private readonly secrets: SecretsProvider) {}

  async notifyReviewCompleted({ ref, findingsCount }: ReviewNotification): Promise<void> {
    const url = await this.secrets.get(SLACK_WEBHOOK_SECRET_NAME);
    if (!url) return; // not configured: notifications are optional

    const text = `Review finished for ${ref.owner}/${ref.repo}#${ref.number}: ${findingsCount} finding(s).`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook responded with ${res.status}`);
    }
  }
}
