# INSIGHTS.md — @devdigest/mcp

Append-only. Read before starting work in this package. Updated by the
`engineering-insights` skill — only when a session learns something
non-obvious; never rewritten, only appended to.

## What Works

- In-memory protocol tests: `InMemoryTransport.createLinkedPair()` (exported by both
  `@modelcontextprotocol/server` and `/client`), `server.connect(serverT)`,
  `client.connect(clientT)`, then `client.listTools()` / `client.callTool()`. See `test/server.test.ts`.
- Progress end-to-end: client passes `{ onprogress }` to `callTool`; the server handler
  emits via `ctx.mcpReq.notify(...)` (below). Verified in `test/server.test.ts`.

## What Doesn't Work

- `npx`/`npm run` to launch the server: they print to stdout. Launch `node ... tsx/dist/cli.mjs` directly.

## Codebase Patterns

- Tools are registrar functions `(server, deps) => void` (`src/deps.ts`); `createMcpServer`
  takes them as a list so registration order (= `tools/list` order) is explicit.

## Tool & Library Notes

Verified against installed `@modelcontextprotocol/server@2.3.0` (+ `/client@2.3.0`) types.
Discrepancies vs the plan's assumptions:

- **Progress**: there is no `sendNotification` on the context. Token: `ctx.mcpReq._meta?.progressToken`
  (string | number). Send with
  `await ctx.mcpReq.notify({ method: 'notifications/progress', params: { progressToken, progress, total?, message? } })`.
  Only send when a token is present.
- **Abort**: `ctx.mcpReq.signal` (AbortSignal), not `ctx.signal`.
- **Context shape**: handler is `(args, ctx: ServerContext)`; request info lives under `ctx.mcpReq`
  (`id`, `method`, `_meta`, `signal`, `notify`, `send`, deprecated `log`/`elicitInput`/`requestSampling`).
  `ctx.mcpReq.log` (MCP logging) is deprecated — we log to stderr instead.
- **registerTool**: `inputSchema` should be a Standard Schema (`z.object({...})`, zod >= 4.2). The raw-shape
  form (`{ a: z.string() }`) still works but is `@deprecated`. `outputSchema` is accepted — we deliberately never set it.
  Args are parsed through the schema, so `z.coerce.number()` works for `"42"` -> 42.
- **Constructor**: `new McpServer({ name, version }, { instructions })`; `instructions` is a `ServerOptions` field
  and surfaces on the client as `client.getInstructions()`.
- **Client is a separate package**: `Client` lives in `@modelcontextprotocol/client` (added as devDependency
  for tests); `@modelcontextprotocol/server` only exports `InMemoryTransport`, `Server`, `McpServer`, etc.
- Server transport for stdio: `StdioServerTransport` from `@modelcontextprotocol/server/stdio` (subpath export).
- `npm install` prints an `allow-scripts` warning for esbuild's postinstall (npm 11+); vitest/tsx run fine
  without approving it.

## Decisions

- Tool-result helpers always emit `{ content: [{ type: 'text', text }] }`; `isError: true` only via `toolError`.
- `capResponse` hard-cuts (no hint) if the limit is smaller than the hint itself, so the limit is always honoured.

## Recurring Errors & Fixes

- (none yet)

## Session Notes

- T4 scaffold: package, config, API port/adapter, lib helpers and server factory created with unit tests.
