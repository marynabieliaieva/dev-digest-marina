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

describe('OpenRouterProvider reasoning', () => {
  it('disables reasoning only when the request opts in', async () => {
    await new OpenRouterProvider('k').completeStructured(req({ reasoning: 'off' }));
    expect(create.mock.calls[0]![0].reasoning).toEqual({ enabled: false });
  });

  it('leaves the model default when the request does not opt in', async () => {
    await new OpenRouterProvider('k').completeStructured(req());
    expect('reasoning' in create.mock.calls[0]![0]).toBe(false);
  });

  it('retries without reasoning when the model rejects disabling it', async () => {
    create.mockReset();
    create
      .mockRejectedValueOnce(Object.assign(new Error('Reasoning is mandatory for this endpoint'), { status: 400 }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    const out = await new OpenRouterProvider('k').completeStructured(req({ reasoning: 'off' }));
    expect(out.data).toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect('reasoning' in create.mock.calls[1]![0]).toBe(false);
  });
});
