import type { DigestNotifier } from '@devdigest/shared';

export class MockDigestNotifier implements DigestNotifier {
  sent: { title: string; body: string }[] = [];
  async notifyDigest(title: string, body: string): Promise<void> {
    this.sent.push({ title, body });
  }
}
