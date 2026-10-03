import { McpServer } from '@modelcontextprotocol/server';
import type { DevdigestApi } from './api/client.js';
import type { McpConfig } from './config.js';
import type { ToolDeps, ToolRegistrar } from './deps.js';
import { systemClock, type Clock } from './lib/time.js';

export const SERVER_NAME = 'devdigest';
export const SERVER_VERSION = '0.0.0';

/** Sent on every session start — keep it tiny (it costs tokens in every request). */
export const SERVER_INSTRUCTIONS =
  'devdigest: local AI PR review. List reviewer agents, run a review on a GitHub PR, read findings and repo conventions.';

export interface CreateServerOptions {
  api: DevdigestApi;
  config: McpConfig;
  /** Tool registrars, in registration (= tools/list) order. */
  tools?: readonly ToolRegistrar[];
  clock?: Clock;
}

/**
 * Build the MCP server (no transport attached — `index.ts` / tests connect one).
 * Pure composition: no I/O, no process access.
 */
export function createMcpServer(opts: CreateServerOptions): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const deps: ToolDeps = { api: opts.api, config: opts.config, clock: opts.clock ?? systemClock };
  for (const register of opts.tools ?? []) register(server, deps);
  return server;
}
