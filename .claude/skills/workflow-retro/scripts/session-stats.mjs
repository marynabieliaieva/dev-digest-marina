#!/usr/bin/env node
// session-stats.mjs — deterministic numbers for /workflow-retro --deep.
//
// Reads a Claude Code session transcript (<session>.jsonl) and its subagent
// transcripts (<session>/subagents/agent-*.jsonl + .meta.json) and prints one
// JSON document: per-agent tokens, API calls, tool usage, tool errors, timing,
// and the spawn order. Read-only; never writes anywhere.
//
// Usage:
//   node session-stats.mjs [--session <id>] [--project-dir <dir>] [--since <ISO>] [--until <ISO>]
//
//   --session      session id (default: the most recently modified *.jsonl in the project dir)
//   --project-dir  default: ~/.claude/projects/<cwd with [:\/.] replaced by "-">
//   --since/--until  only count records inside this time window (scope one workflow run)
//
// Token accounting: one API call is written as several JSONL lines sharing a
// requestId, each repeating `usage`. We keep the LAST line per requestId.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const projectDir =
  args['project-dir'] ??
  join(homedir(), '.claude', 'projects', process.cwd().replace(/[:\\/.]/g, '-'));

if (!existsSync(projectDir)) {
  console.error(`project dir not found: ${projectDir}`);
  process.exit(2);
}

let sessionId = args.session;
if (!sessionId) {
  const newest = readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, t: statSync(join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  if (!newest) {
    console.error(`no session transcripts in ${projectDir}`);
    process.exit(2);
  }
  sessionId = newest.f.replace(/\.jsonl$/, '');
}

const since = args.since ? Date.parse(args.since) : -Infinity;
const until = args.until ? Date.parse(args.until) : Infinity;
const inWindow = (ts) => {
  const t = Date.parse(ts ?? '');
  return Number.isNaN(t) || (t >= since && t <= until);
};

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function summarize(records, { mainOnly = false } = {}) {
  const byRequest = new Map();
  const tools = {};
  let toolErrors = 0;
  let first = null;
  let last = null;
  const models = new Set();

  for (const r of records) {
    if (mainOnly && r.isSidechain) continue;
    if (!inWindow(r.timestamp)) continue;
    if (r.timestamp) {
      if (!first || r.timestamp < first) first = r.timestamp;
      if (!last || r.timestamp > last) last = r.timestamp;
    }
    const msg = r.message;
    if (!msg) continue;
    if (r.type === 'assistant') {
      if (msg.model) models.add(msg.model);
      if (msg.usage) byRequest.set(r.requestId ?? r.uuid, msg.usage);
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c.type === 'tool_use') tools[c.name] = (tools[c.name] ?? 0) + 1;
      }
    } else if (r.type === 'user') {
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c.type === 'tool_result' && c.is_error) toolErrors++;
      }
    }
  }

  const tokens = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  for (const u of byRequest.values()) {
    tokens.input += u.input_tokens ?? 0;
    tokens.cache_write += u.cache_creation_input_tokens ?? 0;
    tokens.cache_read += u.cache_read_input_tokens ?? 0;
    tokens.output += u.output_tokens ?? 0;
  }
  tokens.total = tokens.input + tokens.cache_write + tokens.cache_read + tokens.output;

  return {
    models: [...models],
    api_calls: byRequest.size,
    tokens,
    tool_calls: Object.values(tools).reduce((a, b) => a + b, 0),
    tools,
    tool_errors: toolErrors,
    started: first,
    ended: last,
    duration_s: first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 1000) : null,
  };
}

const mainPath = join(projectDir, `${sessionId}.jsonl`);
const main = existsSync(mainPath) ? summarize(readJsonl(mainPath), { mainOnly: true }) : null;

const subDir = join(projectDir, sessionId, 'subagents');
const agents = [];
if (existsSync(subDir)) {
  for (const f of readdirSync(subDir).filter((x) => /^agent-.*\.jsonl$/.test(x))) {
    const id = f.replace(/^agent-|\.jsonl$/g, '');
    const metaPath = join(subDir, `agent-${id}.meta.json`);
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
    const s = summarize(readJsonl(join(subDir, f)));
    if (s.api_calls === 0 && !s.started) continue; // entirely outside the window
    agents.push({
      id,
      type: meta.agentType ?? 'unknown',
      description: meta.description ?? '',
      background: meta.requestShape === 'background',
      ...s,
    });
  }
}
agents.sort((a, b) => (a.started ?? '').localeCompare(b.started ?? ''));
agents.forEach((a, i) => (a.order = i + 1));

const sum = (pick) => agents.reduce((n, a) => n + pick(a), 0);
const byType = {};
for (const a of agents) {
  const t = (byType[a.type] ??= { count: 0, tokens: 0, api_calls: 0, tool_errors: 0 });
  t.count++;
  t.tokens += a.tokens.total;
  t.api_calls += a.api_calls;
  t.tool_errors += a.tool_errors;
}

// Peak parallelism: max number of agents whose [started, ended] intervals overlap.
const events = agents
  .filter((a) => a.started && a.ended)
  .flatMap((a) => [
    [Date.parse(a.started), 1],
    [Date.parse(a.ended), -1],
  ])
  .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
let live = 0;
let peak = 0;
for (const [, d] of events) peak = Math.max(peak, (live += d));

console.log(
  JSON.stringify(
    {
      session: sessionId,
      window: { since: args.since ?? null, until: args.until ?? null },
      main,
      agents,
      totals: {
        agents: agents.length,
        peak_parallel_agents: peak,
        subagent_tokens: sum((a) => a.tokens.total),
        subagent_output_tokens: sum((a) => a.tokens.output),
        main_tokens: main?.tokens.total ?? null,
        all_tokens: (main?.tokens.total ?? 0) + sum((a) => a.tokens.total),
        tool_errors: sum((a) => a.tool_errors) + (main?.tool_errors ?? 0),
        by_type: byType,
      },
    },
    null,
    2,
  ),
);
