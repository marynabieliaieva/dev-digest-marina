import type { SecretsProvider } from '@devdigest/shared';

export class MockSecretsProvider implements SecretsProvider {
  constructor(private readonly values: Record<string, string> = {}) {}
  async get(name: string): Promise<string | null> {
    return this.values[name] ?? null;
  }
}
