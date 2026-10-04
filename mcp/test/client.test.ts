import { describe, expect, it, vi } from 'vitest';
import { ApiError, createFetchApi } from '../src/api/client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function api(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return createFetchApi({ baseUrl: 'http://api.test/', timeoutMs, fetch: fetchImpl });
}

const runDetail = {
  run: {
    run_id: 'r1', status: 'running', error: null, agent_id: 'a', agent_name: 'n', model: 'm',
    ran_at: null, duration_ms: null, pr_number: 1, repo_full_name: 'o/r',
  },
  review: null,
};

describe('createFetchApi', () => {
  it('listAgents strips unmirrored fields such as system_prompt', async () => {
    const f = vi.fn(async () =>
      json([{ id: '1', name: 'sec', description: 'd', model: 'gpt', enabled: true, system_prompt: 'SECRET' }]),
    );
    const agents = await api(f as unknown as typeof fetch).listAgents();
    expect(agents).toEqual([{ id: '1', name: 'sec', description: 'd', model: 'gpt', enabled: true }]);
    expect(JSON.stringify(agents)).not.toContain('SECRET');
  });

  it('encodes path and query values', async () => {
    const f = vi.fn(async (_u: unknown) => json(runDetail));
    await api(f as unknown as typeof fetch).getRun('a/b?c#d');
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/runs/a%2Fb%3Fc%23d');

    const g = vi.fn(async (_u: unknown) => json({ id: 'x', full_name: 'o/r' }));
    await api(g as unknown as typeof fetch).resolveRepo('o/r&x=1');
    expect(g.mock.calls[0]?.[0]).toBe('http://api.test/repos/resolve?repo=o%2Fr%26x%3D1');

    const h = vi.fn(async (_u: unknown) => json([]));
    await api(h as unknown as typeof fetch).latestReview('o/r', 7);
    expect(h.mock.calls[0]?.[0]).toBe('http://api.test/reviews/latest?repo=o%2Fr&pr=7');
  });

  it('resolvePull encodes the query; getBlast encodes the path and parses the mirror', async () => {
    const f = vi.fn(async (_u: unknown) => json({ id: 'p1' }));
    await api(f as unknown as typeof fetch).resolvePull('o/r&x=1', 7);
    expect(f.mock.calls[0]?.[0]).toBe('http://api.test/pulls/resolve?repo=o%2Fr%26x%3D1&pr=7');

    const blast = {
      pr_id: 'p', indexed_sha: null, index_status: 'future_value', degraded: true, reason: 'new_reason',
      blast: { changed_symbols: [], downstream: [], summary: 's' },
    };
    const g = vi.fn(async (_u: unknown) => json(blast));
    const out = await api(g as unknown as typeof fetch).getBlast('a/b?c');
    expect(g.mock.calls[0]?.[0]).toBe('http://api.test/pulls/a%2Fb%3Fc/blast');
    expect(out.reason).toBe('new_reason');
  });

  it('POSTs JSON for reviewByRef', async () => {
    const f = vi.fn(async (_u: unknown, _i?: RequestInit) =>
      json({ pr: { id: 'p', number: 1, title: 't', repo_full_name: 'o/r' }, runs: [] }),
    );
    await api(f as unknown as typeof fetch).reviewByRef({ repo: 'o/r', pr: 1, all: true });
    const init = f.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ repo: 'o/r', pr: 1, all: true }));
  });

  it.each([
    [400, 'bad_request'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'unprocessable'],
    [429, 'rate_limited'],
    [500, 'server'],
  ] as const)('maps HTTP %i to kind %s and keeps the server message', async (status, kind) => {
    const f = async () => json({ message: 'boom detail' }, status);
    const err = await api(f as unknown as typeof fetch).getRun('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe(kind);
    expect((err as ApiError).message).toBe('boom detail');
    expect((err as ApiError).status).toBe(status);
  });

  it('maps network failure to unreachable', async () => {
    const f = async () => {
      throw new TypeError('fetch failed');
    };
    const err = await api(f as unknown as typeof fetch).listAgents().catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe('unreachable');
  });

  it('maps a hung request to timeout', async () => {
    const f = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    const err = await api(f as unknown as typeof fetch, 20).listAgents().catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe('timeout');
  });

  it('maps caller abort to aborted', async () => {
    const ac = new AbortController();
    const f = (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    const p = api(f as unknown as typeof fetch).listAgents({ signal: ac.signal }).catch((e: unknown) => e);
    ac.abort();
    expect(((await p) as ApiError).kind).toBe('aborted');
  });

  it('flags contract mismatches and non-JSON as invalid_response', async () => {
    const bad = await api((async () => json({ nope: 1 })) as unknown as typeof fetch)
      .getRun('x').catch((e: unknown) => e);
    expect((bad as ApiError).kind).toBe('invalid_response');
    const text = await api((async () => new Response('<html>')) as unknown as typeof fetch)
      .listAgents().catch((e: unknown) => e);
    expect((text as ApiError).kind).toBe('invalid_response');
  });
});
