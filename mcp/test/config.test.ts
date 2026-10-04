import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toEqual({
      apiUrl: 'http://localhost:3001',
      requestTimeoutMs: 15_000,
      runDeadlineMs: 120_000,
      pollIntervalMs: 2_000,
      maxResponseChars: 32_000,
    });
  });

  it('strips trailing slashes and reads overrides', () => {
    const c = loadConfig({ DEVDIGEST_API_URL: 'http://127.0.0.1:4000//', DEVDIGEST_RUN_DEADLINE_MS: '500' });
    expect(c.apiUrl).toBe('http://127.0.0.1:4000');
    expect(c.runDeadlineMs).toBe(500);
  });

  it('rejects non-http URLs and bad numbers', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'file:///etc/passwd' })).toThrow(ConfigError);
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'nope' })).toThrow(ConfigError);
    expect(() => loadConfig({ DEVDIGEST_POLL_INTERVAL_MS: '-1' })).toThrow(ConfigError);
    expect(() => loadConfig({ DEVDIGEST_POLL_INTERVAL_MS: 'abc' })).toThrow(ConfigError);
  });
});
