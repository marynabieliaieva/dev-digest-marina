import { describe, expect, it } from 'vitest';
import { buildAlert, compareDelta, isStaleBatch, promptDiff, type AlertMetrics } from './helpers.js';

const m = (over: Partial<AlertMetrics> = {}): AlertMetrics => ({
  agent_version: 3,
  recall: 0.9,
  precision: 0.9,
  citation_accuracy: 0.9,
  ...over,
});

describe('buildAlert', () => {
  it('ignores a 1.9 pt drop, alerts at 2.0', () => {
    expect(buildAlert(m({ recall: 0.881 }), m())).toBeNull();
    expect(buildAlert(m({ recall: 0.88 }), m())).toBe('Recall dipped 2 pts on v3 — an expected finding was missed');
  });
  it('picks the largest drop', () => {
    expect(buildAlert(m({ recall: 0.85, precision: 0.7 }), m())).toBe(
      'Precision dipped 20 pts on v3 — a new false positive slipped in',
    );
  });
  it('ties pick recall > precision > citation', () => {
    expect(buildAlert(m({ precision: 0.8, citation_accuracy: 0.8 }), m())).toMatch(/^Precision/);
    expect(buildAlert(m({ recall: 0.8, precision: 0.8, citation_accuracy: 0.8 }), m())).toMatch(/^Recall/);
    expect(buildAlert(m({ citation_accuracy: 0.8 }), m())).toBe(
      'Citation accuracy dipped 10 pts on v3 — more findings failed citation grounding',
    );
  });
  it('skips a metric when either side is null', () => {
    expect(buildAlert(m({ recall: null }), m())).toBeNull();
    expect(buildAlert(m({ recall: 0.1 }), m({ recall: null }))).toBeNull();
  });
});

describe('promptDiff', () => {
  it('identical prompts are all same', () => {
    expect(promptDiff('a\nb', 'a\nb').every((l) => l.op === 'same')).toBe(true);
  });
  it('one changed line => one del + one add', () => {
    const d = promptDiff('a\nb\nc', 'a\nX\nc');
    expect(d.filter((l) => l.op === 'del')).toEqual([{ op: 'del', text: 'b' }]);
    expect(d.filter((l) => l.op === 'add')).toEqual([{ op: 'add', text: 'X' }]);
    expect(d.filter((l) => l.op === 'same')).toHaveLength(2);
  });
});

describe('compareDelta', () => {
  it('is head - base, null when either side is null', () => {
    const d = compareDelta(
      { recall: 0.5, precision: null, citation_accuracy: 0.9, cost_usd: 0.1 },
      { recall: 0.75, precision: 0.8, citation_accuracy: 0.8, cost_usd: null },
    );
    expect(d.recall).toBeCloseTo(0.25);
    expect(d.precision).toBeNull();
    expect(d.citation_accuracy).toBeCloseTo(-0.1);
    expect(d.cost_usd).toBeNull();
  });
});

describe('isStaleBatch', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it('true at 31 min when not live', () => {
    expect(isStaleBatch({ id: 'b', status: 'running', startedAt: ago(31) }, now, new Set())).toBe(true);
  });
  it('false at 31 min when live', () => {
    expect(isStaleBatch({ id: 'b', status: 'running', startedAt: ago(31) }, now, new Set(['b']))).toBe(false);
  });
  it('false at 29 min', () => {
    expect(isStaleBatch({ id: 'b', status: 'running', startedAt: ago(29) }, now, new Set())).toBe(false);
  });
  it('false when not running', () => {
    expect(isStaleBatch({ id: 'b', status: 'done', startedAt: ago(90) }, now, new Set())).toBe(false);
  });
});
