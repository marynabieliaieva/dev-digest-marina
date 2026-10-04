import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

/**
 * Regression: OpenRouter replies 200 + headers immediately, then holds the body
 * open while the upstream model stalls. The SDK timeout (headers only) never
 * fired, so a run hung forever. The provider must fail within its own deadline.
 */
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.write(' '); // headers + keep-alive whitespace, body never completes
});
const listening = new Promise<string>((resolve) =>
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
);

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('OpenRouterProvider deadline', () => {
  it('rejects a stalled response body instead of hanging', async () => {
    const baseURL = await listening;
    const provider = new OpenRouterProvider('k', { baseURL, timeoutMs: 300, maxRetries: 0 });
    const started = Date.now();
    await expect(
      provider.completeStructured({
        model: 'm',
        schema: z.object({ ok: z.boolean() }),
        schemaName: 'Ok',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/stalled/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
