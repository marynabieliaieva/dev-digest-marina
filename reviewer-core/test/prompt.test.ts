/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## Derived intent', () => {
  it('renders after PR description, before Skills, untrusted-wrapped, with scope instruction', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'body',
      skills: ['SKILL'],
      intent: 'Summary: add limiter',
    });
    const user = messages[1]!.content;
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Derived intent'));
    expect(user.indexOf('## Derived intent')).toBeLessThan(user.indexOf('## Skills / rules'));
    expect(user).toContain('<untrusted source="derived-intent">');
    expect(user).toContain('set each finding\'s `scope`');
    expect(assembly.intent).toBe('Summary: add limiter');
  });

  it('without intent the user message is byte-identical to the legacy layout', () => {
    const user = userOf({
      system: 'sys',
      task: 'TASK',
      prDescription: 'body',
      skills: ['S1'],
      memory: ['m1'],
      diff: 'DIFF',
    });
    expect(user).toBe(
      [
        'TASK',
        '## PR description\n<untrusted source="pr-description">\nbody\n</untrusted>',
        '## Skills / rules\nS1',
        '## Relevant memory\n- m1',
        '## Diff to review\n<untrusted source="diff">\nDIFF\n</untrusted>',
      ].join('\n\n'),
    );
    expect(userOf({ system: 'sys', diff: 'D', intent: '  ' })).not.toContain('## Derived intent');
  });

  it('composition lists only present sections, stats only', () => {
    const { composition } = assemblePrompt({ system: 'sys', diff: 'DIFF', intent: 'I' });
    expect(composition.map((s) => s.name)).toEqual(['system', 'intent', 'diff']);
    for (const s of composition) {
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.est_tokens).toBe(Math.ceil(s.chars / 4));
      expect(Object.keys(s).sort()).toEqual(['chars', 'est_tokens', 'name', 'sha256']);
    }
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});
