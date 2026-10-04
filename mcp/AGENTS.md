# mcp/CLAUDE.md

Map for `@devdigest/mcp`. Root map: [../CLAUDE.md](../CLAUDE.md). Deep dive: [README.md](README.md).

## Role

Local **stdio MCP server** exposing DevDigest (reviewer agents, PR reviews,
findings, repo conventions, blast radius) to MCP clients such as Claude Code.
It is a **thin HTTP wrapper over the API on :3001** — all business rules
(repo/PR lookup, auto-sync, de-duplication of runs, "latest review") live in
`server/`, never here.

## Run / test

```sh
npm install
npm test            # vitest, no Docker, no network (fake fetch / in-memory transport)
npm run typecheck
```

Launch (as `.mcp.json` does, from the repo root):
`node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts` — not `npm run`/`npx`
(they write banners to stdout and break the protocol; `.cmd` shims on Windows).

## Layout

- `src/config.ts` — env -> `McpConfig` (pure).
- `src/api/client.ts` — `DevdigestApi` port + `createFetchApi` adapter; `ApiError.kind`.
- `src/api/types.ts` — local zod-4 mirrors of the server contracts (lenient, strip unknown keys).
- `src/lib/*` — `toolText`/`toolError`, `apiErrorToTool`, `capResponse`, `fence`, `advanceStatus`, `Clock`, stderr `log`.
- `src/deps.ts` — `ToolDeps`, `ToolRegistrar`. `src/server.ts` — `createMcpServer`.
- `src/tools/*`, `src/format/*`, `src/index.ts` — tools, shared formatters, stdio entrypoint.

## Non-default conventions

- Dependency direction: tools -> `DevdigestApi` port (interface) -> fetch adapter.
  Tools never call `fetch`; tests inject a fake `DevdigestApi` / `Clock`.
- **Never import `@devdigest/shared`** (zod 3 in `server/`; this package is zod ^4.2
  because `@modelcontextprotocol/server` v2 needs it). Mirror what you need in `src/api/types.ts`.
- **stdout is the protocol.** No `console.log`, no `process.stdout.write`. Log via `lib/log.ts` (stderr).
- Tool responses are `content[].text` (compact markdown) only — **no `outputSchema`, no
  `structuredContent`** (Claude Code would show the model only structuredContent).
- Tool names are `devdigest_*`. Descriptions are English, short; every response goes through `capResponse`.
- Untrusted text (rationale, snippets, PR titles) is output as data: truncated and `fence`d.
- "Still running" is a normal result, not `isError`. Errors use `apiErrorToTool` so they name the next step.

## Learnings

Read [`INSIGHTS.md`](INSIGHTS.md) before starting work here — it records where the
installed SDK v2 API differs from the plan.

## Gotchas

- Run status only moves forward; use `advanceStatus` when polling.
- Tests use an in-memory transport with `@modelcontextprotocol/client` (devDependency).

## Do not touch

- `package-lock.json`.
