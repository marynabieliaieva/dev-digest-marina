import { MultiAgentRunRequest as MultiAgentRunRequestSchema } from '@devdigest/shared';
import type {
  AgentColumn,
  AgentColumnFinding,
  Conflict,
  ConflictTake,
  MultiAgentRun,
  MultiAgentRunRequest,
  Severity,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import {
  CANCELLED_NOTE,
  DID_NOT_FLAG_NOTE,
  FAILED_NOTE,
  GROUP_LINE_TOLERANCE,
  SEVERITY_RANK,
} from './constants.js';

/** Pure, DB-free helpers for the multi-agent run: grouping, derivation, median. */

/**
 * Validate the start-run body. Throws a 400 (not the global 422 a zod-provider body schema
 * would give) because the contract wants 400 for a bad agent list.
 */
export function parseStartRequest(body: unknown): MultiAgentRunRequest {
  const parsed = MultiAgentRunRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError(
      'invalid_multi_agent_run_request',
      'agentIds must be 1–5 unique agent ids',
      400,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

interface Entry {
  colIdx: number;
  f: AgentColumnFinding;
}

const endOf = (f: AgentColumnFinding): number => f.end_line ?? f.start_line;

/** Severity rank, tolerant of an unexpected stored value (lowest rank). */
const rank = (s: string): number => SEVERITY_RANK[s as Severity] ?? 0;

/**
 * Pick the "best" entry: highest severity, then earliest column, then lowest
 * start_line, then lowest id.
 */
function best(entries: Entry[]): Entry {
  return [...entries].sort(
    (a, b) =>
      rank(b.f.severity) - rank(a.f.severity) ||
      a.colIdx - b.colIdx ||
      a.f.start_line - b.f.start_line ||
      a.f.id.localeCompare(b.f.id),
  )[0]!;
}

function buildGroup(file: string, members: Entry[], columns: AgentColumn[]): Conflict {
  const line = Math.min(...members.map((m) => m.f.start_line));
  const endLine = Math.max(...members.map((m) => endOf(m.f)));
  const title = best(members).f.title;

  const takes: ConflictTake[] = [];
  columns.forEach((col, colIdx) => {
    // A still-running column gets NO take: we never invent a verdict for an unfinished
    // agent. The client hides the disagreement rows while anything is running.
    if (col.status === 'running') return;
    const base = { run_id: col.run_id, agent_id: col.agent_id, persona: col.agent_name };
    if (col.status === 'failed' || col.status === 'cancelled') {
      takes.push({
        ...base,
        verdict: col.status,
        note: col.status === 'failed' ? FAILED_NOTE : CANCELLED_NOTE,
        finding_ids: [],
      });
      return;
    }
    const mine = members.filter((m) => m.colIdx === colIdx);
    if (mine.length === 0) {
      takes.push({ ...base, verdict: 'ignored', note: DID_NOT_FLAG_NOTE, finding_ids: [] });
      return;
    }
    const top = [...mine].sort(
      (a, b) =>
        rank(b.f.severity) - rank(a.f.severity) ||
        a.f.start_line - b.f.start_line ||
        a.f.id.localeCompare(b.f.id),
    )[0]!;
    takes.push({
      ...base,
      verdict: top.f.severity as Severity,
      note: top.f.title,
      finding_ids: mine.map((m) => m.f.id),
    });
  });

  return { file, line, end_line: endLine, title, is_conflict: isConflict(takes), takes };
}

function isConflict(takes: ConflictTake[]): boolean {
  const flagged = takes.filter((t) => t.verdict !== 'ignored' && t.verdict !== 'failed' && t.verdict !== 'cancelled');
  const ignored = takes.some((t) => t.verdict === 'ignored');
  if (flagged.length === 0) return false;
  if (ignored) return true;
  return new Set(flagged.map((t) => t.verdict)).size > 1;
}

/** Group findings from the `done` columns by file + nearby lines. Never mutates its input. */
export function groupFindings(columns: AgentColumn[]): Conflict[] {
  const byFile = new Map<string, Entry[]>();
  columns.forEach((col, colIdx) => {
    if (col.status !== 'done') return;
    for (const f of col.findings) {
      const list = byFile.get(f.file) ?? [];
      list.push({ colIdx, f });
      byFile.set(f.file, list);
    }
  });

  const out: Conflict[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const sorted = [...byFile.get(file)!].sort(
      (a, b) =>
        a.f.start_line - b.f.start_line ||
        endOf(a.f) - endOf(b.f) ||
        a.colIdx - b.colIdx ||
        a.f.id.localeCompare(b.f.id),
    );
    let current: Entry[] = [];
    let maxEnd = -Infinity;
    for (const e of sorted) {
      if (current.length > 0 && e.f.start_line <= maxEnd + GROUP_LINE_TOLERANCE) {
        current.push(e);
        maxEnd = Math.max(maxEnd, endOf(e.f));
      } else {
        if (current.length > 0) out.push(buildGroup(file, current, columns));
        current = [e];
        maxEnd = endOf(e.f);
      }
    }
    if (current.length > 0) out.push(buildGroup(file, current, columns));
  }
  return out;
}

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/** Status and totals derived from the columns. Unknown sums are null, never 0. */
export function deriveTotals(
  columns: AgentColumn[],
): Pick<MultiAgentRun, 'status' | 'total_duration_ms' | 'total_cost_usd' | 'total_tokens_in' | 'total_tokens_out'> {
  const durations = columns.map((c) => c.duration_ms).filter((v): v is number => v != null);
  return {
    status: columns.some((c) => c.status === 'running') ? 'running' : 'done',
    total_duration_ms: durations.length === 0 ? 0 : Math.max(...durations),
    total_cost_usd: sumOrNull(columns.map((c) => c.cost_usd)),
    total_tokens_in: sumOrNull(columns.map((c) => c.tokens_in)),
    total_tokens_out: sumOrNull(columns.map((c) => c.tokens_out)),
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Map a stored agent_runs.status to the column status; unknown/null → 'failed'. */
export function toColumnStatus(status: string | null): AgentColumn['status'] {
  return status === 'done' || status === 'running' || status === 'cancelled' ? status : 'failed';
}
