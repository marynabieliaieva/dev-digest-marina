import OpenAI from 'openai';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { toJsonSchema, parseWithRepair } from './structured.js';

/**
 * The single OpenAI-compatible structured provider, owned by the engine because
 * BOTH consumers need it: the CI runner (the GitHub Action runs reviewer-core
 * directly) and the studio server's openrouter path. Centralizing it here means
 * session grouping, the no-choices guard, request timeouts, and the
 * parse-with-repair loop live in ONE place instead of being duplicated.
 *
 * OpenRouter is OpenAI-compatible, so we drive it with the OpenAI SDK pointed at
 * its baseURL. Only completeStructured is needed by reviewPullRequest; the rest
 * are stubs. Cost attribution is INJECTED (`estimateCost`) so the engine stays
 * free of a pricing table — the server passes its own, the runner passes none.
 */

/**
 * Hard wall-clock deadline per LLM attempt. The SDK's own `timeout` only covers
 * the time until response HEADERS: OpenRouter answers 200 immediately and then
 * keeps the body open (keep-alive whitespace) until the upstream model finishes,
 * so a stalled upstream hung the run forever. An AbortSignal also covers the body.
 */
const DEFAULT_DEADLINE_MS = 90_000;
/** Attempts per structured call when the deadline fires (stalled upstream). */
const DEADLINE_ATTEMPTS = 2;

const NOT_SUPPORTED = 'OpenRouterProvider only implements completeStructured';

export interface OpenRouterProviderOptions {
  /** OpenAI-compatible base URL (default: OpenRouter). */
  baseURL?: string;
  /** Provider id for traces/gating (default 'openrouter'). */
  id?: 'openai' | 'openrouter';
  /** Per-request timeout (ms) — the SDK retries on timeout/5xx/429 with backoff. */
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected cost estimator; returns USD or null when the model is unknown. */
  estimateCost?: (model: string, tokensIn: number, tokensOut: number) => number | null;
}

export class OpenRouterProvider implements LLMProvider {
  readonly id: 'openai' | 'openrouter';
  private client: OpenAI;
  private timeoutMs: number;
  private baseURL: string;
  private apiKey: string;
  private estimateCost?: OpenRouterProviderOptions['estimateCost'];

  constructor(apiKey: string, opts: OpenRouterProviderOptions = {}) {
    this.id = opts.id ?? 'openrouter';
    this.apiKey = apiKey;
    this.baseURL = opts.baseURL ?? 'https://openrouter.ai/api/v1';
    this.estimateCost = opts.estimateCost;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_DEADLINE_MS;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: this.timeoutMs,
      maxRetries: opts.maxRetries ?? 2,
    });
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const maxRetries = req.maxRetries ?? 2;
    const messages = [...req.messages];
    let tokensIn = 0;
    let tokensOut = 0;
    let costFromApi: number | null = null;
    let lastRaw = '';

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const res = await this.createWithDeadline(req.timeoutMs ?? this.timeoutMs, {
        model: req.model,
        messages,
        temperature: req.temperature ?? 0,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true },
        },
        // OpenRouter session grouping — extra body field (spread is exempt from
        // excess-property checks). Only sent when talking to OpenRouter.
        ...(this.id === 'openrouter' && req.sessionId ? { session_id: req.sessionId } : {}),
        // OpenRouter usage accounting — ask it to return the REAL generation
        // cost (USD) in `usage.cost`, instead of estimating from a price book.
        ...(this.id === 'openrouter' ? { usage: { include: true } } : {}),
        // Opt-in per call: hidden "thinking" tokens made a 17k-token review
        // prompt take >80s (vs ~16s with reasoning off).
        ...(this.id === 'openrouter' && req.reasoning === 'off' ? { reasoning: { enabled: false } } : {}),
        // Route only to upstream providers that support every parameter (strict
        // json_schema). OpenRouter-specific body field.
        ...(this.id === 'openrouter' && req.requireParameters === true
          ? { provider: { require_parameters: true } }
          : {}),
      });

      // OpenRouter can return HTTP 200 with no `choices` (an upstream provider
      // error / moderation / free-tier limit in the body) — surface it.
      const choice = res.choices?.[0];
      if (!choice) {
        const errMsg = (res as unknown as { error?: { message?: string } }).error?.message;
        throw new Error(`OpenRouter returned no choices for ${req.schemaName}${errMsg ? `: ${errMsg}` : ''}`);
      }
      lastRaw = choice.message?.content ?? '';
      tokensIn += res.usage?.prompt_tokens ?? 0;
      tokensOut += res.usage?.completion_tokens ?? 0;
      // `usage.cost` is an OpenRouter extension (USD), absent from the OpenAI SDK type.
      const apiCost = (res.usage as { cost?: number } | null | undefined)?.cost;
      if (typeof apiCost === 'number') costFromApi = (costFromApi ?? 0) + apiCost;

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          costUsd: costFromApi ?? this.estimateCost?.(req.model, tokensIn, tokensOut) ?? null,
          raw: lastRaw,
          attempts: attempt,
        };
      }
      messages.push({ role: 'assistant', content: lastRaw });
      messages.push({ role: 'user', content: parsed.repromptMessage });
    }
    throw new Error(`OpenRouter structured output failed schema validation for ${req.schemaName}`);
  }

  /** One chat completion with a hard deadline covering headers AND body; retried on stall. */
  private async createWithDeadline(
    deadlineMs: number,
    body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.client.chat.completions.create(body, {
          signal: AbortSignal.timeout(deadlineMs),
        });
      } catch (err) {
        // Some models make reasoning mandatory and reject `enabled:false` with a
        // 400 — drop the field and retry (not counted as a stalled attempt).
        const e = err as { status?: number; message?: string };
        if ('reasoning' in body && e.status === 400 && /reasoning/i.test(e.message ?? '')) {
          delete (body as { reasoning?: unknown }).reasoning;
          attempt--;
          continue;
        }
        const name = (err as Error).name;
        const stalled = name === 'TimeoutError' || name === 'AbortError' || name === 'APIUserAbortError';
        if (!stalled) throw err;
        if (attempt >= DEADLINE_ATTEMPTS) {
          throw new Error(
            `OpenRouter request for ${body.model} stalled: no complete response within ${Math.round(deadlineMs / 1000)}s (${attempt} attempt(s))`,
          );
        }
      }
    }
  }

  /**
   * List models with pricing from the OpenRouter `/models` endpoint (the OpenAI
   * SDK's models.list strips the `pricing` field, so we fetch raw). Prices are
   * converted from per-token to USD per 1M tokens; cheapest output first.
   */
  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models: ModelInfo[] = (json.data ?? []).map((m) => {
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      // OpenRouter uses -1 as a sentinel for variable-priced router pseudo-models
      // (openrouter/auto etc.) — treat negatives as "unknown" so they don't show
      // as $-1000000 and don't sort to the top of the cheapest list.
      const pricing =
        Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
          ? { promptPerM: prompt * 1_000_000, completionPerM: completion * 1_000_000 }
          : null;
      return {
        id: m.id,
        provider: 'openrouter' as const,
        label: m.name ?? null,
        pricing,
        contextLength: m.context_length ?? null,
      };
    });
    return models.sort(
      (a, b) => (a.pricing?.completionPerM ?? Infinity) - (b.pricing?.completionPerM ?? Infinity),
    );
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error(NOT_SUPPORTED);
  }
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_SUPPORTED);
  }
}
