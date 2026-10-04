import type { CallToolResult } from '@modelcontextprotocol/server';
import { ApiError } from '../api/client.js';
import { log } from './log.js';
import { toolError } from './tool-result.js';

export interface ApiErrorContext {
  /** Shown in the "API not running" hint. */
  apiUrl: string;
  /** What the tool was doing, e.g. "starting the review". */
  action?: string;
}

function hintFor(err: ApiError, ctx: ApiErrorContext): string {
  switch (err.kind) {
    case 'unreachable':
      return `Cannot reach the DevDigest API at ${ctx.apiUrl}. Start it with ./scripts/dev.sh (API listens on :3001) and retry.`;
    case 'timeout':
      return `The DevDigest API at ${ctx.apiUrl} did not respond in time. Check that it is healthy, then retry.`;
    case 'aborted':
      return 'The request was cancelled.';
    case 'not_found':
      return `${err.message} Check the repo (owner/name, and that it was added in DevDigest), PR number, or run id; devdigest_list_agents lists valid agent ids.`;
    case 'conflict':
      return `${err.message} Retry with the full owner/name.`;
    case 'unprocessable':
      return `${err.message} Pick another agent via devdigest_list_agents (enabled ones are listed first).`;
    case 'rate_limited':
      return 'Rate limit reached (reviews are limited to 10 per minute). Wait about a minute before retrying; do not retry in a loop.';
    case 'bad_request':
      return `${err.message} Fix the arguments and retry.`;
    case 'invalid_response':
      return `${err.message} The DevDigest API and this MCP server may be out of sync; update both.`;
    case 'server':
      return `DevDigest API error: ${err.message} Check the API logs, then retry.`;
  }
}

/**
 * Map a thrown error to a model-readable `isError` tool result that names the
 * next step. Unknown errors are logged to stderr and surfaced WITHOUT stack
 * traces or internals.
 */
export function apiErrorToTool(err: unknown, ctx: ApiErrorContext): CallToolResult {
  if (err instanceof ApiError) {
    const prefix = ctx.action ? `Failed while ${ctx.action}. ` : '';
    return toolError(`${prefix}${hintFor(err, ctx)}`);
  }
  log('error', `unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  return toolError('Unexpected internal error in the DevDigest MCP server; see its stderr log. Retry once, then report it.');
}
