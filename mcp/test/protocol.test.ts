import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DevdigestApi } from '../src/api/client.js';
import { loadConfig } from '../src/config.js';
import { createMcpServer, SERVER_INSTRUCTIONS } from '../src/server.js';
import { allTools } from '../src/tools/index.js';

async function listTools() {
  const server = createMcpServer({ api: {} as DevdigestApi, config: loadConfig({}), tools: allTools });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  await client.connect(clientT);
  return { client, ...(await client.listTools()) };
}

const EXPECTED = [
  'devdigest_list_agents',
  'devdigest_run_agent_on_pr',
  'devdigest_get_findings',
  'devdigest_get_conventions',
  'devdigest_get_blast_radius',
];

describe('tools/list protocol contract', () => {
  it('exposes exactly the 5 tools in deterministic order, devdigest_ prefixed', async () => {
    const { tools } = await listTools();
    expect(tools.map((t) => t.name)).toEqual(EXPECTED);
    for (const t of tools) expect(t.name.startsWith('devdigest_')).toBe(true);
  });

  it('has no outputSchema on any tool', async () => {
    const { tools } = await listTools();
    for (const t of tools) expect(t.outputSchema).toBeUndefined();
  });

  it('sets annotations per plan', async () => {
    const { tools } = await listTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const name of EXPECTED.filter((n) => n !== 'devdigest_run_agent_on_pr')) {
      expect(by[name]).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    expect(by['devdigest_run_agent_on_pr']).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('keeps descriptions short and tools/list small', async () => {
    const { tools } = await listTools();
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(0);
      expect(t.description!.length).toBeLessThanOrEqual(450);
    }
    expect(JSON.stringify(tools).length).toBeLessThanOrEqual(8000);
  });

  it('advertises the short instructions string', async () => {
    const { client } = await listTools();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Comments may legitimately mention the forbidden names ("never use console.log"). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('source hygiene', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const files = sourceFiles(srcDir).map((f) => ({ f, text: stripComments(readFileSync(f, 'utf8')) }));

  it('has no console.* and no stdout writes (stdout is the protocol)', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const { f, text } of files) {
      expect(text, f).not.toMatch(/\bconsole\s*\./);
      expect(text, f).not.toMatch(/process\.stdout/);
    }
  });

  it('never imports @devdigest/shared (zod 3 vs zod 4)', () => {
    for (const { f, text } of files) expect(text, f).not.toContain('@devdigest/shared');
  });
});
