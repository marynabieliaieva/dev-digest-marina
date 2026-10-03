# @devdigest/mcp

Local stdio [MCP](https://modelcontextprotocol.io) server for DevDigest. It lets
Claude Code (or any MCP client) list reviewer agents, run a review on a GitHub PR,
read findings and repo conventions. It is a thin HTTP wrapper over the DevDigest
API (default `http://localhost:3001`) — orchestration lives in `server/`.

## Tools

| Tool | Purpose |
|---|---|
| `devdigest_list_agents` | List reviewer agents (id, name, model, enabled) |
| `devdigest_run_agent_on_pr` | Run an agent on a PR; blocks up to ~120 s, else returns `running` + `run_id` |
| `devdigest_get_findings` | Verdict + findings by `run_id` or `repo`+`pr` (concise/detailed, paging, filters) |
| `devdigest_get_conventions` | Extracted coding conventions for a repo |
| `devdigest_get_blast_radius` | Callers, endpoints and crons a PR's changes can affect (from the repo index); needs `repo` + `pr` |

(Tool modules are added in later tasks; this package currently contains the shared scaffold.)

## Configuration (env)

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | DevDigest API base URL (http/https) |
| `DEVDIGEST_REQUEST_TIMEOUT_MS` | `15000` | Per HTTP request timeout |
| `DEVDIGEST_RUN_DEADLINE_MS` | `120000` | Blocking wait for a review run |
| `DEVDIGEST_POLL_INTERVAL_MS` | `2000` | Run polling interval |
| `DEVDIGEST_MAX_RESPONSE_CHARS` | `32000` | Max characters per tool response (~8k tokens) |

## Develop

```sh
npm install
npm test
npm run typecheck
```

The DevDigest API must be running for real use: `./scripts/dev.sh` from the repo root.
Logs go to stderr only (stdout carries the protocol).
