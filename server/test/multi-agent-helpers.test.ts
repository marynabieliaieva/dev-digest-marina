import { describe, it, expect } from 'vitest';
import type { AgentColumn, AgentColumnFinding } from '@devdigest/shared';
import { groupFindings, deriveTotals, median } from '../src/modules/multi-agent/helpers.js';

let seq = 0;
const finding = (over: Partial<AgentColumnFinding> = {}): AgentColumnFinding => ({
  id: `f${seq++}`,
  severity: 'WARNING',
  category: 'bug',
  title: 'Something',
  file: 'a.ts',
  start_line: 10,
  end_line: null,
  kind: 'finding',
  ...over,
});

const column = (over: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: `r${seq++}`,
  agent_id: `a${seq}`,
  agent_name: `Agent ${seq}`,
  provider: 'openai',
  model: 'gpt-4.1',
  status: 'done',
  error: null,
  verdict: null,
  score: null,
  summary: null,
  duration_ms: null,
  cost_usd: null,
  tokens_in: null,
  tokens_out: null,
  findings_count: null,
  findings: [],
  ...over,
});

describe('groupFindings', () => {
  it('groups by file + line proximity (AC-11)', () => {
    const near = groupFindings([
      column({ findings: [finding({ start_line: 10, end_line: 12 })] }),
      column({ findings: [finding({ start_line: 15 })] }),
    ]);
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ file: 'a.ts', line: 10, end_line: 15 });

    const far = groupFindings([
      column({ findings: [finding({ start_line: 10 })] }),
      column({ findings: [finding({ start_line: 16 })] }),
    ]);
    expect(far).toHaveLength(2);
  });

  it('builds takes with severity / ignored / failed and flags conflicts (AC-13..16)', () => {
    const groups = groupFindings([
      column({ findings: [finding({ severity: 'CRITICAL' })] }),
      column({ findings: [] }),
      column({ status: 'failed' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.takes.map((t) => t.verdict)).toEqual(['CRITICAL', 'ignored', 'failed']);
    expect(groups[0]!.is_conflict).toBe(true);

    const diverge = groupFindings([
      column({ findings: [finding({ severity: 'WARNING' })] }),
      column({ findings: [finding({ severity: 'SUGGESTION' })] }),
    ]);
    expect(diverge[0]!.is_conflict).toBe(true);

    const oneFailed = groupFindings([
      column({ findings: [finding({ severity: 'WARNING' })] }),
      column({ status: 'failed' }),
    ]);
    expect(oneFailed[0]!.is_conflict).toBe(false);
  });
});

describe('deriveTotals', () => {
  it('keeps unknown cost null and duration 0 when nothing is measured', () => {
    const totals = deriveTotals([column(), column()]);
    expect(totals).toMatchObject({
      status: 'done',
      total_cost_usd: null,
      total_duration_ms: 0,
      total_tokens_in: null,
    });
  });

  it('sums cost, takes max duration, and is running while any column runs', () => {
    const totals = deriveTotals([
      column({ duration_ms: 100, cost_usd: 0.5 }),
      column({ status: 'running', duration_ms: 300, cost_usd: null }),
    ]);
    expect(totals).toMatchObject({ status: 'running', total_duration_ms: 300, total_cost_usd: 0.5 });
  });
});

describe('median', () => {
  it('handles odd, even and empty input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
