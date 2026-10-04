/**
 * Runtime configuration, read once from the environment at startup.
 * Pure: takes the env as a parameter so tests never touch `process.env`.
 */
export interface McpConfig {
  /** Base URL of the DevDigest API, no trailing slash. */
  apiUrl: string;
  /** Per-HTTP-request timeout. */
  requestTimeoutMs: number;
  /** Shared deadline for a blocking `run_agent_on_pr` call (D8: 120 s). */
  runDeadlineMs: number;
  /** Interval between `GET /runs/:id` polls (D8: 2 s). */
  pollIntervalMs: number;
  /** Max characters of a single tool response (D9: ~8k tokens). */
  maxResponseChars: number;
}

export const DEFAULT_API_URL = 'http://localhost:3001';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got "${raw}"`);
  }
  return n;
}

function parseApiUrl(raw: string | undefined): string {
  const value = raw && raw.trim() !== '' ? raw.trim() : DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`DEVDIGEST_API_URL is not a valid URL: "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError(`DEVDIGEST_API_URL must be http(s), got "${url.protocol}"`);
  }
  return value.replace(/\/+$/, '');
}

export function loadConfig(env: Record<string, string | undefined> = {}): McpConfig {
  return {
    apiUrl: parseApiUrl(env.DEVDIGEST_API_URL),
    requestTimeoutMs: positiveInt(env.DEVDIGEST_REQUEST_TIMEOUT_MS, 15_000, 'DEVDIGEST_REQUEST_TIMEOUT_MS'),
    runDeadlineMs: positiveInt(env.DEVDIGEST_RUN_DEADLINE_MS, 120_000, 'DEVDIGEST_RUN_DEADLINE_MS'),
    pollIntervalMs: positiveInt(env.DEVDIGEST_POLL_INTERVAL_MS, 2_000, 'DEVDIGEST_POLL_INTERVAL_MS'),
    maxResponseChars: positiveInt(env.DEVDIGEST_MAX_RESPONSE_CHARS, 32_000, 'DEVDIGEST_MAX_RESPONSE_CHARS'),
  };
}
