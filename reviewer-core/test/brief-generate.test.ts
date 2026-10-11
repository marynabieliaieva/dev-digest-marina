import { describe, it, expect } from 'vitest';
import type { LLMProvider } from '@devdigest/shared';
import { generateBrief, BRIEF_MAX_OUTPUT_TOKENS } from '../src/index.js';

const messages = [
  { role: 'system' as const, content: 's' },
  { role: 'user' as const, content: 'u' },
];

function fake(impl: (req: any) => Promise<any>) {
  const calls: any[] = [];
  const llm = {
    completeStructured: (req: any) => {
      calls.push(req);
      return impl(req);
    },
  } as unknown as LLMProvider;
  return { llm, calls };
}

describe('generateBrief', () => {
  it('makes exactly one structured call and returns attempts', async () => {
    const { llm, calls } = fake(async () => ({
      data: { summary: 's', risks: [], review_focus: [] },
      tokensIn: 10,
      tokensOut: 5,
      costUsd: null,
      attempts: 3,
    }));
    const r = await generateBrief({ llm, model: 'm', messages });
    expect(calls).toHaveLength(1);
    expect(calls[0].schemaName).toBe('PrBriefGeneration');
    expect(calls[0].maxTokens).toBe(BRIEF_MAX_OUTPUT_TOKENS);
    expect(r.attempts).toBe(3);
    expect(r.costUsd).toBeNull();
  });

  it('propagates errors unchanged after one call', async () => {
    const err = new Error('boom');
    const { llm, calls } = fake(async () => {
      throw err;
    });
    await expect(generateBrief({ llm, model: 'm', messages })).rejects.toBe(err);
    expect(calls).toHaveLength(1);
  });
});
