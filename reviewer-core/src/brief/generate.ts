import { PrBriefGeneration } from '@devdigest/shared';
import type { ChatMessage, LLMProvider } from '@devdigest/shared';
import { BRIEF_MAX_OUTPUT_TOKENS } from './constants.js';

export interface GenerateBriefArgs {
  llm: LLMProvider;
  model: string;
  messages: ChatMessage[];
  sessionId?: string;
}

/**
 * Exactly one structured call, no tools, no loop around it. Errors propagate
 * unchanged: the server classifies them.
 */
export async function generateBrief(args: GenerateBriefArgs) {
  const res = await args.llm.completeStructured({
    model: args.model,
    schema: PrBriefGeneration,
    schemaName: 'PrBriefGeneration',
    messages: args.messages,
    temperature: 0,
    maxRetries: 2,
    maxTokens: BRIEF_MAX_OUTPUT_TOKENS,
    requireParameters: true,
    reasoning: 'off',
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
  });
  return {
    output: res.data,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
    costUsd: res.costUsd,
    attempts: res.attempts,
  };
}
