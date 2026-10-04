import { IntentClassification } from '@devdigest/shared';
import type { ChatMessage, LLMProvider } from '@devdigest/shared';

export interface ClassifyIntentArgs {
  llm: LLMProvider;
  model: string;
  prompt: { messages: ChatMessage[] };
  sessionId?: string;
}

/**
 * One structured call to the (cheap) classifier model. Deliberately passes NO
 * tools: the classifier only reads untrusted text and returns the schema.
 */
export async function classifyIntent(args: ClassifyIntentArgs) {
  const res = await args.llm.completeStructured({
    model: args.model,
    schema: IntentClassification,
    schemaName: 'IntentClassification',
    messages: args.prompt.messages,
    temperature: 0,
    maxRetries: 2,
    maxTokens: 1200,
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
    raw: res.raw,
  };
}
