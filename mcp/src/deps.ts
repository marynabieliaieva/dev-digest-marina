import type { McpServer } from '@modelcontextprotocol/server';
import type { DevdigestApi } from './api/client.js';
import type { McpConfig } from './config.js';
import type { Clock } from './lib/time.js';

/** Everything a tool needs, injected (no module-level singletons). */
export interface ToolDeps {
  api: DevdigestApi;
  config: McpConfig;
  /** Injectable clock for polling tools; defaults to the system clock. */
  clock: Clock;
}

/** One tool module = one registrar. `tools/index.ts` (T8) lists them in a fixed order. */
export type ToolRegistrar = (server: McpServer, deps: ToolDeps) => void;
