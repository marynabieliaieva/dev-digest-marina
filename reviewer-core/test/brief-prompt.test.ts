import { describe, it, expect } from 'vitest';
import { buildBriefPrompt, newSideRanges, BRIEF_TOKEN_BUDGET, type BriefPromptInput } from '../src/index.js';

const PATCH = '@@ -1,3 +10,4 @@ fn\n context\n+const MARKER_7f3a = 1;\n-old';

const base = (over: Partial<BriefPromptInput> = {}): BriefPromptInput => ({
  title: 'Title',
  body: 'Body',
  intent: {
    summary: 'sum',
    in_scope: ['a'],
    out_of_scope: [],
    risk_areas: [],
    confidence: 'high',
    missing_context: [],
  },
  intentStale: false,
  files: [{ path: 'src/a.ts', role: 'core', additions: 3, deletions: 1, patch: PATCH }],
  blast: { summary: 'blast sum', degraded: false, reason: null, callers: [{ name: 'f', file: 'src/b.ts', line: 5 }] },
  linkedIssue: null,
  specs: [],
  gapNotes: [],
  ...over,
});

const text = (p: ReturnType<typeof buildBriefPrompt>) => p.messages.map((m) => m.content).join('');

describe('newSideRanges', () => {
  it('reads hunk headers only', () => {
    expect(newSideRanges(PATCH)).toEqual([[10, 13]]);
    expect(newSideRanges('@@ -1 +7 @@\n+x')).toEqual([[7, 7]]);
    expect(newSideRanges('@@ -5,2 +4,0 @@\n-x\n-y')).toEqual([]);
    expect(newSideRanges(null)).toEqual([]);
  });
});

describe('buildBriefPrompt', () => {
  it('keeps the AC-16 section order', () => {
    const p = buildBriefPrompt(base({ specs: [{ path: 'docs/x.md', content: 'x' }] }));
    expect(p.inputs.map((i) => i.name)).toEqual(['pr', 'intent', 'diff', 'blast', 'linked_issue', 'specs']);
    expect(p.inputs.find((i) => i.name === 'linked_issue')!.status).toBe('missing');
    expect(p.inputs.find((i) => i.name === 'specs')!.ref).toBe('docs/x.md');
  });

  it('sends ranges but never diff body lines', () => {
    const t = text(buildBriefPrompt(base()));
    expect(t).not.toContain('MARKER_7f3a');
    expect(t).not.toContain('context');
    expect(t).toContain('10-13');
  });

  it('stays within the budget with huge specs and 6 gap notes, and keeps the gap note', () => {
    const specs = Array.from({ length: 3 }, (_, i) => ({ path: `docs/${i}.md`, content: 'y'.repeat(40000) }));
    const p = buildBriefPrompt(base({ specs, gapNotes: Array.from({ length: 6 }, (_, i) => `intent gap note ${i}`) }));
    const chars = text(p).length;
    expect(p.estTokens).toBe(Math.ceil(chars / 4));
    expect(p.estTokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    const specStatuses = p.inputs.filter((i) => i.name === 'specs').map((i) => i.status);
    expect(specStatuses.every((s) => s === 'truncated' || s === 'dropped')).toBe(true);
    for (const n of ['pr', 'intent', 'diff']) expect(p.inputs.find((i) => i.name === n)!.status).toBe('used');
    expect(p.messages[1]!.content).toContain('intent gap note 0');
    expect(p.budgetGaps.some((g) => g.source === 'budget')).toBe(true);
  });

  it('lists 100 files plus a count line for the rest', () => {
    const files = Array.from({ length: 120 }, (_, i) => ({
      path: `f${i}.ts`,
      role: 'core' as const,
      additions: 120 - i,
      deletions: 0,
      patch: null,
    }));
    const t = buildBriefPrompt(base({ files })).messages[1]!.content;
    expect(t).toContain('f0.ts');
    expect(t).toContain('f99.ts');
    expect(t).not.toContain('f100.ts');
    expect(t).toContain('and 20 more changed files');
  });

  it('cuts title at 300 and body at 4000 chars', () => {
    const t = buildBriefPrompt(base({ title: 'T'.repeat(500), body: 'B'.repeat(9000) })).messages[1]!.content;
    expect(t).toContain('T'.repeat(300));
    expect(t).not.toContain('T'.repeat(301));
    expect(t).toContain('B'.repeat(4000));
    expect(t).not.toContain('B'.repeat(4001));
  });
});
