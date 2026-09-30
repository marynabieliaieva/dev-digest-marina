import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { applyIntentScope, renderIntentBlock, reviewPullRequest } from '../src/index.js';

function f(over: Partial<Finding> & { id: string }): Finding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: `title-${over.id}`,
    file: 'src/config.ts',
    start_line: 11,
    end_line: 11,
    rationale: `why-${over.id}`,
    confidence: 0.5,
    kind: 'finding',
    scope: 'in_scope',
    ...over,
  };
}

const mixed = (): Finding[] => [
  f({ id: 'in1' }),
  f({ id: 'oos-crit', severity: 'CRITICAL', scope: 'out_of_scope', confidence: 0.9 }),
  f({ id: 'oos-warn', severity: 'WARNING', category: 'bug', scope: 'out_of_scope' }),
  f({ id: 'oos-sug', severity: 'SUGGESTION', scope: 'out_of_scope' }),
  f({ id: 'in2', severity: 'SUGGESTION' }),
];

describe('applyIntentScope', () => {
  it('disabled → returns everything unchanged', () => {
    const r = applyIntentScope(mixed(), { enabled: false });
    expect(r.kept).toHaveLength(5);
    expect(r.suppressed).toHaveLength(0);
    expect(r.signal).toBeNull();
  });

  it('keeps in-scope + exactly one [Out of scope] CRITICAL signal', () => {
    const r = applyIntentScope(mixed(), { enabled: true });
    expect(r.kept).toHaveLength(3);
    expect(r.suppressed).toHaveLength(2);
    const sig = r.kept.filter((k) => k.title.startsWith('[Out of scope] '));
    expect(sig).toHaveLength(1);
    expect(sig[0]!.severity).toBe('CRITICAL');
    expect(sig[0]!.rationale).toContain('2 other out-of-scope finding(s) suppressed');
    expect(r.signal).toBe(sig[0]);
  });

  it('only out-of-scope SUGGESTIONs → suppressed, no signal', () => {
    const r = applyIntentScope(
      [
        f({ id: 'a' }),
        f({ id: 'b', severity: 'SUGGESTION', scope: 'out_of_scope' }),
        f({ id: 'c', severity: 'SUGGESTION', scope: 'out_of_scope' }),
      ],
      { enabled: true },
    );
    expect(r.kept.map((k) => k.id)).toEqual(['a']);
    expect(r.signal).toBeNull();
  });

  it('two out-of-scope CRITICALs → exactly one kept (higher confidence)', () => {
    const r = applyIntentScope(
      [
        f({ id: 'lo', severity: 'CRITICAL', scope: 'out_of_scope', confidence: 0.4 }),
        f({ id: 'hi', severity: 'CRITICAL', scope: 'out_of_scope', confidence: 0.9 }),
      ],
      { enabled: true },
    );
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.id).toBe('hi');
    expect(r.kept[0]!.rationale).toContain('1 other out-of-scope finding(s) suppressed');
  });

  it('out-of-scope security WARNING (no CRITICAL) is suppressed, no signal (Q4)', () => {
    const r = applyIntentScope(
      [f({ id: 'sec', severity: 'WARNING', category: 'security', scope: 'out_of_scope' })],
      { enabled: true },
    );
    expect(r.kept).toHaveLength(0);
    expect(r.suppressed).toHaveLength(1);
    expect(r.signal).toBeNull();
  });

  it('secret_leak is always kept and is not the signal', () => {
    const r = applyIntentScope(
      [
        f({ id: 'leak', kind: 'secret_leak', severity: 'CRITICAL', scope: 'out_of_scope' }),
        f({ id: 'oos', severity: 'WARNING', scope: 'out_of_scope' }),
      ],
      { enabled: true },
    );
    expect(r.kept.map((k) => k.id)).toEqual(['leak']);
    expect(r.kept[0]!.title).toBe('title-leak');
    expect(r.signal).toBeNull();
  });

  it('scope null/undefined findings are always kept', () => {
    const r = applyIntentScope(
      [f({ id: 'n', scope: null }), f({ id: 'u', scope: undefined })],
      { enabled: true },
    );
    expect(r.kept).toHaveLength(2);
  });
});

describe('renderIntentBlock', () => {
  it('renders summary, scope lists, risk areas, confidence and stale note', () => {
    const t = renderIntentBlock(
      {
        summary: 'Add rate limiting',
        in_scope: ['limiter'],
        out_of_scope: [],
        risk_areas: ['auth'],
        confidence: 'medium',
      },
      { staleNote: 'derived for abc1234' },
    );
    expect(t).toContain('Summary: Add rate limiting');
    expect(t).toContain('- limiter');
    expect(t).toContain('- (none)');
    expect(t).toContain('Confidence: medium');
    expect(t).toContain('Note: derived for abc1234');
  });
});

describe('reviewPullRequest with intent', () => {
  const structured = {
    verdict: 'request_changes',
    summary: 's',
    score: 1,
    findings: mixed(),
  };
  const intent = { block: 'Summary: x', filterEnabled: true };

  it('filters, scores from the kept set, and emits composition + scope events', async () => {
    const llm = new MockLLMProvider('openai', { structured });
    const diff = await new MockGitClient().diff();
    const events: { kind: string; msg: string; data?: unknown }[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'sys',
      model: 'm',
      diff,
      llm,
      intent,
      onEvent: (e) => events.push(e),
    });

    const expected = applyIntentScope(mixed(), { enabled: true });
    expect(outcome.review.findings).toEqual(expected.kept);
    expect(outcome.scopeSuppressed).toHaveLength(2);
    // in1 WARNING 12 + in2 SUGGESTION 3 + signal CRITICAL 35 = 50 → 50
    expect(outcome.review.score).toBe(50);
    expect(outcome.assembly.intent).toBe('Summary: x');
    expect(outcome.composition.map((s) => s.name)).toContain('intent');

    const main = events.filter((e) => e.msg.startsWith('review: main request — '));
    expect(main).toHaveLength(outcome.chunks.length);
    expect((main[0]!.data as { call: string }).call).toBe('review');
    expect(main[0]!.msg).not.toContain('Summary: x');
    expect(events.some((e) => e.msg === 'Scope filter: kept 3, suppressed 2, signal 1')).toBe(true);
    // main-request event precedes the result of the LLM call
    expect(events.findIndex((e) => e.msg.startsWith('review: main request')))
      .toBeLessThan(events.findIndex((e) => e.msg.includes('candidate finding')));
  });

  it('without intent nothing is filtered and no Scope filter event fires', async () => {
    const llm = new MockLLMProvider('openai', { structured });
    const diff = await new MockGitClient().diff();
    const msgs: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'sys',
      model: 'm',
      diff,
      llm,
      onEvent: (e) => msgs.push(e.msg),
    });
    expect(outcome.review.findings).toHaveLength(5);
    expect(outcome.scopeSuppressed).toHaveLength(0);
    expect(msgs.some((m) => m.startsWith('Scope filter'))).toBe(false);
  });
});
