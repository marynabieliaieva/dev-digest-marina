import type { CallToolResult } from '@modelcontextprotocol/server';
import { capResponse } from './cap.js';

/**
 * Tool results are ALWAYS `content[].text` (compact markdown) — never
 * `structuredContent`/`outputSchema` (D4): Claude Code shows the model only
 * structuredContent when both are present.
 */

/** Successful (or non-error "status") text result, capped (D9). */
export function toolText(text: string, maxChars?: number): CallToolResult {
  return { content: [{ type: 'text', text: capResponse(text, maxChars) }] };
}

/** Error result with a hint for the next step (`isError: true`). */
export function toolError(text: string, maxChars?: number): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: capResponse(text, maxChars) }] };
}
