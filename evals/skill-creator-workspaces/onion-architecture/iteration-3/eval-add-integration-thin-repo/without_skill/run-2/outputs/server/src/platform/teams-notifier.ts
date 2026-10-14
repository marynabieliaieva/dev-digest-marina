import type { Digest } from '@devdigest/shared';
import type { DigestNotifier } from '../modules/digests/ports.js';

/** Posts a digest to a Microsoft Teams incoming webhook (MessageCard payload). */
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
        '@context': 'https://schema.org/extensions',
        summary: `Digest for repo ${digest.repoId}`,
        title: `Digest for repo ${digest.repoId}`,
        text: digest.body.replace(/\n/g, '\n\n'),
      }),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook responded ${res.status}`);
    }
  }
}

/** Returns null when TEAMS_WEBHOOK_URL is unset, so posting is simply disabled. */
export function createTeamsNotifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DigestNotifier | null {
  const url = env.TEAMS_WEBHOOK_URL;
  return url ? new TeamsWebhookNotifier(url) : null;
}
