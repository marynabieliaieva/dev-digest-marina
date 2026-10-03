import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createFetchApi } from './api/client.js';
import { ConfigError, loadConfig } from './config.js';
import { log } from './lib/log.js';
import { createMcpServer } from './server.js';
import { allTools } from './tools/index.js';

/** Stdio entrypoint. stdout is the protocol channel: log to stderr only. */
export async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      log('error', `invalid configuration: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const api = createFetchApi({ baseUrl: config.apiUrl, timeoutMs: config.requestTimeoutMs });
  const server = createMcpServer({ api, config, tools: allTools });
  await server.connect(new StdioServerTransport());
  log('info', `stdio server ready (API ${config.apiUrl})`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    log('error', `fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
