import type { DigestNotifier } from '@devdigest/shared';

export class MockDigestNotifier implements DigestNotifier {
  sent: { title: string; text: string }[] = [];
  async post(title: string, text: string): Promise<void> {
    this.sent.push({ title, text });
  }
}
