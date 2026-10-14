import type { DigestNotifier } from '@devdigest/shared';

export class MockDigestNotifier implements DigestNotifier {
  posted: { title: string; body: string }[] = [];
  async postDigest(title: string, body: string): Promise<void> {
    this.posted.push({ title, body });
  }
}
