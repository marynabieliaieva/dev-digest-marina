#!/usr/bin/env node
// .claude/hooks/implementation-planner-path-guard.mjs
//
// PreToolUse guard for the `implementation-planner` subagent (see
// .claude/agents/implementation-planner.md). Blocks any Edit/Write/NotebookEdit
// call whose target path is not a plan artifact (docs/plans/<slug>.md) — so
// specs (specs/**/spec.md, and legacy docs/features/**/spec.md) and code are unwritable. Keep this
// allowlist and implementation-planner.md's "only file you are allowed to
// write" rule in sync — they are the same contract stated twice. Modelled on
// test-writer-path-guard.mjs.
//
// Node ESM, no dependencies (Node >=22 is already a repo requirement; `jq`
// is not guaranteed on Windows).
//
// SECURITY / fail-closed contract (per the Claude Code hooks reference):
// only exit 0 (allow) and exit 2 (block, stderr shown to the agent) are
// meaningful — ANY other exit code, including the default exit 1 from an
// uncaught exception, lets the tool call proceed. Every path through this
// script must therefore end in exit(0) or exit(2); the outermost try/catch
// exists specifically to catch anything unanticipated (malformed JSON, a
// missing env var, a payload shape we didn't expect) and still exit 2
// rather than silently allowing the write.

import { readFileSync } from 'node:fs';
import path from 'node:path';

// Plan-artifact allowlist: exactly one flat Markdown file per feature,
// `docs/plans/<feature-slug>.md` (no subfolders, no other extensions).
const ALLOWLIST = ['docs/plans/*.md'];

// Nothing inside the allowlist is additionally forbidden today; kept (empty)
// so the allow/deny shape stays identical to test-writer-path-guard.mjs.
const FORBIDDEN = [];

// Minimal glob -> RegExp. Supports `*` (no slash), `**` and a `**` that is
// immediately followed by a slash (matches any depth, including zero). No
// external dependency, on purpose (see file header).
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      out += '(?:.*/)?';
      i += 2; // consume the extra '*' and '/'; the loop's i++ consumes the first '*'
    } else if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else if ('.+^${}()|[]\\?'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(relPath, patterns) {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}

/** Normalizes a raw path string (Windows or POSIX, forward or backward
 * slashes, Git-Bash `/c/...` form) into a lowercase-drive, forward-slash,
 * `.`/`..`-collapsed form. Returns null for non-string/empty input. */
function normalize(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let p = raw.replace(/\\/g, '/');
  // Git-Bash style "/c/Users/..." -> "c:/Users/...". Only fires for a
  // single-letter first path segment, so ordinary POSIX paths like
  // "/home/user/file" are left alone.
  const gitBash = p.match(/^\/([A-Za-z])(\/.*)?$/);
  if (gitBash) {
    p = `${gitBash[1].toLowerCase()}:${gitBash[2] ?? '/'}`;
  }
  // Lowercase a leading drive letter ("C:" -> "c:").
  p = p.replace(/^([A-Za-z]):/, (_, d) => `${d.toLowerCase()}:`);
  // Collapse "." / ".." segments and repeated slashes. path.posix.normalize
  // treats the string purely as slash-separated segments, so the leading
  // "c:" prefix (not itself a separator) rides along unaffected.
  return path.posix.normalize(p);
}

/** Returns the project-relative, forward-slash path, or null if `filePath`
 * is outside `projectDir` or still contains a ".." segment after
 * normalization (i.e. it tried to climb above the project root). */
function toRelative(filePath, projectDir) {
  if (filePath === projectDir) return null; // editing the project dir itself
  const prefix = projectDir.endsWith('/') ? projectDir : `${projectDir}/`;
  if (!filePath.startsWith(prefix)) return null;
  const rel = filePath.slice(prefix.length);
  if (rel === '') return null;
  if (rel.split('/').includes('..')) return null;
  return rel;
}

function reject(reason) {
  process.stderr.write(`implementation-planner-path-guard: ${reason}\n`);
  process.exit(2);
}

function main() {
  let raw;
  try {
    raw = readFileSync(0, 'utf8');
  } catch (err) {
    reject(`could not read stdin (${err && err.message})`);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Fallback: some callers embed a raw Windows path (single backslashes)
    // into the JSON text without escaping it, which strict JSON forbids.
    // Retry once, treating every backslash in the raw text as literal (i.e.
    // re-escape all of them) before parsing again. This only ever widens
    // what gets a chance to reach the allowlist/forbidden check below — it
    // never grants a bypass of that check — and still fails closed if the
    // text isn't recoverable JSON.
    try {
      payload = JSON.parse(raw.replace(/\\/g, '\\\\'));
    } catch {
      reject('stdin was not valid JSON');
      return;
    }
  }

  if (!payload || typeof payload !== 'object') {
    reject('hook payload was not a JSON object');
    return;
  }

  const toolInput =
    payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const rawFilePath =
    typeof toolInput.file_path === 'string'
      ? toolInput.file_path
      : typeof toolInput.notebook_path === 'string'
        ? toolInput.notebook_path
        : undefined;

  const normalizedFile = normalize(rawFilePath);
  if (!normalizedFile) {
    reject('no usable tool_input.file_path or tool_input.notebook_path in payload');
    return;
  }

  const rawProjectDir =
    typeof process.env.CLAUDE_PROJECT_DIR === 'string' && process.env.CLAUDE_PROJECT_DIR.length > 0
      ? process.env.CLAUDE_PROJECT_DIR
      : typeof payload.cwd === 'string'
        ? payload.cwd
        : undefined;
  const projectDir = normalize(rawProjectDir);
  if (!projectDir) {
    reject('could not determine project dir (CLAUDE_PROJECT_DIR unset and payload.cwd missing)');
    return;
  }

  const relPath = toRelative(normalizedFile, projectDir);
  if (relPath === null) {
    reject(`rejected path outside the project or containing ".." — "${rawFilePath}"`);
    return;
  }

  const allowed = matchesAny(relPath, ALLOWLIST) && !matchesAny(relPath, FORBIDDEN);
  if (allowed) {
    process.exit(0);
    return;
  }

  reject(
    `rejected "${relPath}" — implementation-planner may only write to: ${ALLOWLIST.join(', ')}`,
  );
}

try {
  main();
} catch (err) {
  try {
    process.stderr.write(
      `implementation-planner-path-guard: unexpected error, failing closed — ${err && err.stack ? err.stack : err}\n`,
    );
  } catch {
    // stderr itself failed; nothing more we can do, still exit 2 below.
  }
  process.exit(2);
}
