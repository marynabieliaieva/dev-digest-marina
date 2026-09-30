/**
 * Global test isolation from the developer's real credentials.
 *
 * `LocalSecretsProvider` reads `~/.devdigest/secrets.json` and falls back to
 * `process.env`, so without this a test that does not inject a mock for some
 * provider (e.g. `llm.openrouter` for the intent classifier) would build the
 * REAL provider from the developer's keys and hit the network — slow, flaky
 * and billed. Point the secrets store at a non-existent temp file and blank
 * the provider keys so every such path fails fast with a ConfigError instead.
 *
 * HOME is deliberately left alone: testcontainers reads ~/.docker config.
 * Tests that need a key inject it explicitly (MockSecretsProvider / overrides).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DEVDIGEST_SECRETS_PATH = join(
  mkdtempSync(join(tmpdir(), 'devdigest-test-secrets-')),
  'secrets.json',
);

for (const key of [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
]) {
  // Empty string, not `delete`: `platform/config.ts` imports `dotenv/config`,
  // which re-populates MISSING vars from `.env` but never overrides existing
  // ones. An empty value reads as "not configured" everywhere.
  process.env[key] = '';
}
