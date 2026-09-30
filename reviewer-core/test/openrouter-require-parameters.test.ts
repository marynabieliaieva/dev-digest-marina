import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const create = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Schema = z.object({ ok: z.boolean() });

function req(extra: Record<string, unknown> = {}) {
  return {
    model: 'm',
    schema: Schema,
    schemaName: 'Ok',
    messages: [{ role: 'user' as const, content: 'hi' }],
    ...extra,
  };
}

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
});

describe('OpenRouterProvider requireParameters', () => {
  it('sends provider.require_parameters when flag set on openrouter', async () => {
    await new OpenRouterProvider('k').completeStructured(req({ requireParameters: true }));
    expect(create.mock.calls[0]![0].provider).toEqual({ require_parameters: true });
  });

  it('omits provider when the flag is not set', async () => {
    await new OpenRouterProvider('k').completeStructured(req());
    expect('provider' in create.mock.calls[0]![0]).toBe(false);
  });

  it('omits provider for id "openai" even with the flag', async () => {
    await new OpenRouterProvider('k', { id: 'openai' }).completeStructured(
      req({ requireParameters: true }),
    );
    expect('provider' in create.mock.calls[0]![0]).toBe(false);
  });
});
