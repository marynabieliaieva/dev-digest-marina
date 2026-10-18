import { GHA_PERMISSIONS } from './constants.js';

/**
 * Security validation of a USER-EDITED GitHub Actions workflow before it is
 * committed to a target repo (spec AC-32/AC-33). The generated workflow always
 * passes; this guards the `workflow_override` path, where the Preview step lets
 * the user hand-edit the file.
 *
 * `server/` has no YAML parser dependency (lockfile is off-limits), so this is
 * a conservative, indentation-aware line scanner — it only needs to recognise
 * the four structural facts below, and it fails CLOSED on anything it cannot
 * read (e.g. flow-style `permissions: { ... }`).
 *
 *  - W1  `on:` triggers are exactly `pull_request` (never `pull_request_target`,
 *        `workflow_run`, `issue_comment`, `push`, ...).
 *  - W2  a top-level `permissions:` block with exactly the canonical scopes;
 *        any nested `permissions:` may not grant more than those scopes.
 *  - W4  every `uses:` is pinned to a full 40-hex commit SHA (local `./` ok).
 *  - W7  no `github.event.*` / `github.head_ref` / `github.base_ref` / `inputs.*`
 *        expression inside a `run:` script (script-injection vector).
 */

export type WorkflowRuleId = 'W1' | 'W2' | 'W4' | 'W7' | 'YAML';

export interface WorkflowViolation {
  rule: WorkflowRuleId;
  message: string;
  /** 1-based line number when known. */
  line?: number;
}

const SHA_PINNED = /^[^\s@]+@[0-9a-f]{40}$/;
const UNTRUSTED_EXPR = /\$\{\{[^}]*\b(?:github\.event\.|github\.head_ref|github\.base_ref|inputs\.)[^}]*\}\}/;

interface Line {
  no: number;
  indent: number;
  /** Content with the trailing `# comment` removed and trimmed. */
  text: string;
  raw: string;
}

function stripComment(s: string): string {
  // Good enough for workflow lines: a `#` preceded by whitespace starts a comment
  // unless inside quotes. Track simple quote state.
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]!))) {
      return s.slice(0, i);
    }
  }
  return s;
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function toLines(source: string): Line[] {
  return source.split(/\r?\n/).map((raw, i) => {
    const noComment = stripComment(raw);
    const indent = raw.length - raw.trimStart().length;
    return { no: i + 1, indent, text: noComment.trim(), raw };
  });
}

/** Lines belonging to the block that starts after `lines[idx]` (strictly deeper indent). */
function childBlock(lines: Line[], idx: number): Line[] {
  const base = lines[idx]!.indent;
  const out: Line[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.raw.trim() === '') continue;
    if (l.indent <= base) break;
    out.push(l);
  }
  return out;
}

function keyOf(text: string): { key: string; value: string } | null {
  const t = text.replace(/^-\s+/, '');
  const m = /^([A-Za-z0-9_.\-"']+)\s*:(?:\s+(.*))?$/.exec(t);
  if (!m) return null;
  return { key: unquote(m[1]!), value: (m[2] ?? '').trim() };
}

export function validateWorkflow(source: string): WorkflowViolation[] {
  const violations: WorkflowViolation[] = [];
  const lines = toLines(source);

  // AC-33: structural YAML sanity (the only parse errors we can detect without a parser).
  if (source.trim() === '') {
    return [{ rule: 'YAML', message: 'Workflow is empty', line: 1 }];
  }
  for (const l of lines) {
    if (/^\t/.test(l.raw) || /^ *\t/.test(l.raw)) {
      return [{ rule: 'YAML', message: 'Tab characters are not allowed for YAML indentation', line: l.no }];
    }
  }

  // ---- W1: triggers --------------------------------------------------------
  const onIdx = lines.findIndex((l) => l.indent === 0 && /^["']?on["']?\s*:/.test(l.text));
  if (onIdx === -1) {
    violations.push({ rule: 'W1', message: 'Missing top-level `on:` trigger block (must be `pull_request`)' });
  } else {
    const onLine = lines[onIdx]!;
    const { value } = keyOf(onLine.text)!;
    const triggers: string[] = [];
    if (value !== '') {
      // `on: pull_request` or `on: [pull_request, push]` or `on: { ... }`
      const inner = value.replace(/^[[{]/, '').replace(/[\]}]$/, '');
      for (const part of inner.split(',')) {
        const name = unquote(part.split(':')[0]!.trim());
        if (name) triggers.push(name);
      }
    } else {
      const block = childBlock(lines, onIdx);
      const firstIndent = block[0]?.indent;
      for (const l of block) {
        if (l.indent !== firstIndent) continue;
        const kv = keyOf(l.text);
        if (kv) triggers.push(kv.key);
        else if (l.text.startsWith('- ')) triggers.push(unquote(l.text.slice(2).trim()));
      }
    }
    const bad = triggers.filter((t) => t !== 'pull_request');
    if (bad.length > 0) {
      violations.push({
        rule: 'W1',
        message: `Only the \`pull_request\` trigger is allowed (found: ${bad.join(', ')})`,
        line: onLine.no,
      });
    }
    if (!triggers.includes('pull_request')) {
      violations.push({ rule: 'W1', message: 'Workflow must trigger on `pull_request`', line: onLine.no });
    }
  }

  // ---- W2: permissions -----------------------------------------------------
  const allowed = new Map<string, string>(GHA_PERMISSIONS.map(([k, v]) => [k, v]));
  let sawTopLevelPermissions = false;
  lines.forEach((l, idx) => {
    const kv = keyOf(l.text);
    if (!kv || kv.key !== 'permissions') return;
    const topLevel = l.indent === 0;
    if (topLevel) sawTopLevelPermissions = true;

    if (kv.value !== '') {
      // `permissions: read-all|write-all|{}|{ contents: read }` — only inline flow maps we can read.
      violations.push({
        rule: 'W2',
        message: `\`permissions: ${kv.value}\` is not allowed — list exactly: ${[...allowed].map(([k, v]) => `${k}: ${v}`).join(', ')}`,
        line: l.no,
      });
      return;
    }
    const seen = new Map<string, string>();
    for (const child of childBlock(lines, idx)) {
      const c = keyOf(child.text);
      if (!c) continue;
      seen.set(c.key, unquote(c.value));
      const ok = allowed.get(c.key) === unquote(c.value) || (c.key === 'pull-requests' && unquote(c.value) === 'read');
      if (!ok) {
        violations.push({
          rule: 'W2',
          message: `Permission \`${c.key}: ${unquote(c.value)}\` is broader than allowed`,
          line: child.no,
        });
      }
    }
    if (topLevel) {
      for (const [k, v] of allowed) {
        const got = seen.get(k);
        const okRead = k === 'pull-requests' && got === 'read';
        if (got !== v && !okRead) {
          violations.push({ rule: 'W2', message: `Top-level permissions must include \`${k}: ${v}\``, line: l.no });
        }
      }
    }
  });
  if (!sawTopLevelPermissions) {
    violations.push({ rule: 'W2', message: 'Missing top-level `permissions:` block' });
  }

  // ---- W4: pinned actions ---------------------------------------------------
  for (const l of lines) {
    const kv = keyOf(l.text);
    if (!kv || kv.key !== 'uses') continue;
    const ref = unquote(kv.value);
    if (ref.startsWith('./')) continue;
    if (!SHA_PINNED.test(ref)) {
      violations.push({
        rule: 'W4',
        message: `\`uses: ${ref}\` must be pinned to a full 40-character commit SHA`,
        line: l.no,
      });
    }
  }

  // ---- W7: untrusted expressions in run: scripts ----------------------------
  lines.forEach((l, idx) => {
    const kv = keyOf(l.text);
    if (!kv || kv.key !== 'run') return;
    // `run: |` / `run: >` block scalar → scan child lines (use RAW text: `#` is not a comment in scripts).
    const scriptLines: Line[] = /^[|>][+-]?\d*$/.test(kv.value)
      ? childBlock(lines, idx)
      : [{ ...l, text: kv.value }];
    // Inline scripts: scan the raw line (comment stripping would hide `#`-prefixed payloads).
    for (const s of scriptLines) {
      const scan = kv.value !== '' && !/^[|>]/.test(kv.value) ? l.raw : s.raw;
      if (UNTRUSTED_EXPR.test(scan)) {
        violations.push({
          rule: 'W7',
          message: 'Untrusted `github.event.*` / `github.head_ref` expression used inside a `run:` script — pass it via `env:` instead',
          line: s.no,
        });
      }
    }
  });

  return violations;
}
