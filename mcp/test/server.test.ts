import { describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import type { DevdigestApi } from '../src/api/client.js';
import { loadConfig } from '../src/config.js';
import type { ToolRegistrar } from '../src/deps.js';
import { toolText } from '../src/lib/tool-result.js';
import { createMcpServer, SERVER_INSTRUCTIONS } from '../src/server.js';

const api = {} as DevdigestApi;
const config = loadConfig({});

async function connect(tools: ToolRegistrar[]) {
  const server = createMcpServer({ api, config, tools });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  await client.connect(clientT);
  return { server, client };
}

const probe: ToolRegistrar = (server) => {
  server.registerTool(
    'devdigest_probe',
    {
      description: 'probe',
      inputSchema: z.object({ n: z.coerce.number().int() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ n }, ctx) => {
      const token = ctx.mcpReq._meta?.progressToken;
      if (token !== undefined) {
        await ctx.mcpReq.notify({
          method: 'notifications/progress',
          params: { progressToken: token, progress: 1, total: 2, message: 'halfway' },
        });
      }
      return toolText(`n=${n} aborted=${ctx.mcpReq.signal.aborted}`);
    },
  );
};

describe('createMcpServer (SDK v2 smoke)', () => {
  it('advertises instructions and the registered tool without outputSchema', async () => {
    const { client } = await connect([probe]);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['devdigest_probe']);
    expect(tools[0]?.outputSchema).toBeUndefined();
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
  });

  it('coerces args and returns text content only (no structuredContent)', async () => {
    const { client } = await connect([probe]);
    const res = await client.callTool({ name: 'devdigest_probe', arguments: { n: '42' } });
    expect(res.structuredContent).toBeUndefined();
    expect(res.content).toEqual([{ type: 'text', text: 'n=42 aborted=false' }]);
  });

  it('delivers progress notifications when the client passes a progress callback', async () => {
    const { client } = await connect([probe]);
    const seen: Array<{ progress: number; message?: string | undefined }> = [];
    await client.callTool(
      { name: 'devdigest_probe', arguments: { n: 1 } },
      { onprogress: (p) => seen.push({ progress: p.progress, message: p.message }) },
    );
    expect(seen).toEqual([{ progress: 1, message: 'halfway' }]);
  });

  it('registers tools in the order given', async () => {
    const mk = (name: string): ToolRegistrar => (s) => {
      s.registerTool(name, { description: name }, () => toolText(name));
    };
    const { client } = await connect([mk('b'), mk('a')]);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['b', 'a']);
  });
});
