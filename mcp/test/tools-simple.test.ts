import { describe, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { ApiError, type DevdigestApi } from '../src/api/client.js';
import type { ConventionsPage } from '../src/api/types.js';
import { loadConfig } from '../src/config.js';
import type { ToolRegistrar } from '../src/deps.js';
import { createMcpServer } from '../src/server.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { registerListAgents } from '../src/tools/list-agents.js';

async function setup(api: Partial<DevdigestApi>, tool: ToolRegistrar) {
  const server = createMcpServer({ api: api as DevdigestApi, config: loadConfig({}), tools: [tool] });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>).map((p) => p.text).join('\n');
    return { res, text };
  };
  return { client, call };
}

describe('devdigest_list_agents', () => {
  const agents = [
    { id: 'a1', name: 'off', description: 'disabled one', model: 'm1', enabled: false, system_prompt: 'TOP SECRET PROMPT' },
    { id: 'a2', name: 'on', description: 'x'.repeat(300), model: 'm2', enabled: true, system_prompt: 'TOP SECRET PROMPT' },
  ];

  it('lists enabled first, truncates description, never leaks system_prompt', async () => {
    const { call } = await setup({ listAgents: vi.fn().mockResolvedValue(agents) }, registerListAgents);
    const { res, text } = await call('devdigest_list_agents');
    expect(res.isError).toBeFalsy();
    expect(text).not.toContain('TOP SECRET');
    expect(text.indexOf('on · a2')).toBeLessThan(text.indexOf('off · a1'));
    expect(text).toContain('on · a2 · m2 · enabled — ');
    expect(text).not.toContain('x'.repeat(101));
  });

  it('is read-only annotated with no outputSchema', async () => {
    const { client } = await setup({ listAgents: vi.fn() }, registerListAgents);
    const t = (await client.listTools()).tools[0]!;
    expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(t.outputSchema).toBeUndefined();
  });

  it('maps API errors to isError with a hint', async () => {
    const listAgents = vi.fn().mockRejectedValue(new ApiError('unreachable', 'boom'));
    const { call } = await setup({ listAgents }, registerListAgents);
    const { res, text } = await call('devdigest_list_agents');
    expect(res.isError).toBe(true);
    expect(text).toContain('./scripts/dev.sh');
  });
});

describe('devdigest_get_blast_radius', () => {
  const resp = (over: Record<string, unknown> = {}) => ({
    pr_id: 'p1',
    indexed_sha: 'abc',
    index_status: 'full',
    degraded: false,
    reason: null,
    blast: {
      changed_symbols: [{ name: 'foo', file: 'src/a.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'foo',
          callers: [{ name: 'bar', file: 'src/b.ts', line: 12 }],
          endpoints_affected: ['GET /things'],
          crons_affected: [],
        },
      ],
      summary: '1 symbols · 1 callers · 1 endpoints · 0 crons',
    },
    ...over,
  });
  const mk = (r: unknown) => ({
    resolvePull: vi.fn().mockResolvedValue({ id: 'p1' }),
    getBlast: vi.fn().mockResolvedValue(r),
  });

  it('formats callers and endpoints', async () => {
    const api = mk(resp());
    const { call } = await setup(api, registerGetBlastRadius);
    const { res, text } = await call('devdigest_get_blast_radius', { repo: 'o/r', pr: '42' });
    expect(res.isError).toBeFalsy();
    expect(api.resolvePull).toHaveBeenCalledWith('o/r', 42, expect.anything());
    expect(api.getBlast).toHaveBeenCalledWith('p1', expect.anything());
    expect(text).toContain('1 symbols · 1 callers · 1 endpoints · 0 crons');
    expect(text).toContain('src/b.ts:12');
    expect(text).toContain('GET /things');
  });

  it('notes a degraded index', async () => {
    const { call } = await setup(mk(resp({ degraded: true, reason: 'index_partial' })), registerGetBlastRadius);
    const { res, text } = await call('devdigest_get_blast_radius', { repo: 'o/r', pr: 42 });
    expect(res.isError).toBeFalsy();
    expect(text).toContain('Index degraded (index_partial)');
  });

  it('turns a 404 into an isError hint', async () => {
    const api = { resolvePull: vi.fn().mockRejectedValue(new ApiError('not_found', 'HTTP 404', 404)), getBlast: vi.fn() };
    const { call } = await setup(api, registerGetBlastRadius);
    const { res, text } = await call('devdigest_get_blast_radius', { repo: 'o/r', pr: 42 });
    expect(res.isError).toBe(true);
    expect(text).toContain('Check the repo');
    expect(api.getBlast).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ repo: 'o/r' }], [{ pr: 42 }]])('requires both args (%j)', async (args) => {
    const api = mk(resp());
    const { call } = await setup(api, registerGetBlastRadius);
    const { res, text } = await call('devdigest_get_blast_radius', args);
    expect(res.isError).toBe(true);
    expect(text).toContain('Provide both repo');
    expect(api.resolvePull).not.toHaveBeenCalled();
    expect(api.getBlast).not.toHaveBeenCalled();
  });
});

describe('devdigest_get_conventions', () => {
  const snippet = 'S'.repeat(500);
  const page: ConventionsPage = {
    extraction: { id: 'e', status: 'done', sampled_files: 3, created_at: '2026-01-01' },
    candidates: [
      { id: 'c1', category: 'x', rule: 'Use named exports', evidence_path: 'src/a.ts', evidence_line: 3, evidence_snippet: snippet, confidence: 0.9, status: 'accepted' },
      { id: 'c2', category: 'x', rule: 'No default exports ```', evidence_path: 'src/b.ts', evidence_line: null, evidence_snippet: 'a ``` b', confidence: 0.5, status: 'pending' },
    ],
  };
  const mk = (p: ConventionsPage) => ({
    resolveRepo: vi.fn().mockResolvedValue({ id: 'r1', full_name: 'o/r' }),
    getConventions: vi.fn().mockResolvedValue(p),
  });

  it('concise omits snippets', async () => {
    const api = mk(page);
    const { call } = await setup(api, registerGetConventions);
    const { res, text } = await call('devdigest_get_conventions', { repo: 'o/r' });
    expect(res.isError).toBeFalsy();
    expect(api.resolveRepo).toHaveBeenCalledWith('o/r', expect.anything());
    expect(api.getConventions).toHaveBeenCalledWith('r1', expect.anything());
    expect(text).toContain('Use named exports (src/a.ts:3, confidence 0.90, accepted)');
    expect(text).toContain('not accepted');
    expect(text).not.toContain('SSS');
    expect(text).not.toContain('```\n');
  });

  it('detailed fences snippets and caps them at 300', async () => {
    const { call } = await setup(mk(page), registerGetConventions);
    const { text } = await call('devdigest_get_conventions', { repo: 'o/r', response_format: 'detailed' });
    expect(text).toContain('```\n' + 'S'.repeat(299) + '…\n```');
    expect(text).not.toContain('S'.repeat(301));
    // snippet containing backticks gets a longer fence
    expect(text).toContain('````\na ``` b\n````');
  });

  it.each([
    ['no extraction', { extraction: null, candidates: [] }],
    ['empty candidates', { ...page, candidates: [] }],
  ])('gives a scan hint, not an error (%s)', async (_n, p) => {
    const { call } = await setup(mk(p as ConventionsPage), registerGetConventions);
    const { res, text } = await call('devdigest_get_conventions', { repo: 'o/r' });
    expect(res.isError).toBeFalsy();
    expect(text).toContain('scan');
    expect(text).toContain('DevDigest UI');
  });

  it('turns an ambiguous repo into an isError hint', async () => {
    const api = { resolveRepo: vi.fn().mockRejectedValue(new ApiError('conflict', 'ambiguous: a/x, b/x', 409)), getConventions: vi.fn() };
    const { call } = await setup(api, registerGetConventions);
    const { res, text } = await call('devdigest_get_conventions', { repo: 'x' });
    expect(res.isError).toBe(true);
    expect(text).toContain('owner/name');
    expect(api.getConventions).not.toHaveBeenCalled();
  });
});
