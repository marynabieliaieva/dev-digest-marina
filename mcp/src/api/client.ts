import type { ZodType } from 'zod';
import {
  AgentList,
  BlastRadiusResponse,
  ConventionsPage,
  ResolvedPullRef,
  ResolvedRepoRef,
  ReviewByRefResponse,
  RunDetail,
  RunDetailList,
  type AgentSummary,
  type ReviewByRefRequest,
} from './types.js';

/** Why an API call failed — drives the hint a tool shows the model. */
export type ApiErrorKind =
  | 'unreachable' // connection refused / DNS / network
  | 'timeout' // per-request timeout
  | 'aborted' // caller cancelled
  | 'bad_request' // 400
  | 'not_found' // 404
  | 'conflict' // 409 (e.g. ambiguous repo name)
  | 'unprocessable' // 422 (e.g. disabled agent)
  | 'rate_limited' // 429
  | 'server' // 5xx / other non-2xx
  | 'invalid_response'; // 2xx but unparsable / contract mismatch

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface CallOptions {
  /** Caller cancellation (e.g. the MCP request's abort signal). */
  signal?: AbortSignal | undefined;
}

/**
 * Port: everything the MCP tools need from DevDigest. Tools depend on this
 * interface only; the fetch adapter below is the single place that knows HTTP.
 */
export interface DevdigestApi {
  listAgents(opts?: CallOptions): Promise<AgentSummary[]>;
  /** `owner/name` or bare name -> repo id. Throws not_found / conflict. */
  resolveRepo(repo: string, opts?: CallOptions): Promise<ResolvedRepoRef>;
  reviewByRef(body: ReviewByRefRequest, opts?: CallOptions): Promise<ReviewByRefResponse>;
  getRun(runId: string, opts?: CallOptions): Promise<RunDetail>;
  /** Latest run of each agent for a PR. */
  latestReview(repo: string, pr: number, opts?: CallOptions): Promise<RunDetail[]>;
  getConventions(repoId: string, opts?: CallOptions): Promise<ConventionsPage>;
  /** `owner/name` (or bare name) + PR number -> internal PR id. Throws not_found / conflict. */
  resolvePull(repo: string, pr: number, opts?: CallOptions): Promise<ResolvedPullRef>;
  getBlast(prId: string, opts?: CallOptions): Promise<BlastRadiusResponse>;
}

export interface FetchApiOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const MAX_BODY_CHARS = 5_000_000;
const MAX_ERROR_MESSAGE_CHARS = 500;

function errorKindForStatus(status: number): ApiErrorKind {
  switch (status) {
    case 400:
      return 'bad_request';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return 'server';
  }
}

/** Best-effort extraction of a human message from a Fastify-style error body. */
function messageFromBody(text: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      for (const key of ['message', 'error']) {
        const v = rec[key];
        if (typeof v === 'string' && v.trim() !== '') {
          return v.slice(0, MAX_ERROR_MESSAGE_CHARS);
        }
      }
    }
  } catch {
    // not JSON — fall through
  }
  return `HTTP ${status}`;
}

export function createFetchApi(opts: FetchApiOptions): DevdigestApi {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: ZodType<T>,
    call: CallOptions | undefined,
    body?: unknown,
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(opts.timeoutMs);
    const signal = call?.signal ? AbortSignal.any([call.signal, timeoutSignal]) : timeoutSignal;

    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : null,
        redirect: 'error',
        signal,
      });
    } catch (err) {
      if (call?.signal?.aborted) throw new ApiError('aborted', 'Request was cancelled.');
      if (timeoutSignal.aborted) {
        throw new ApiError('timeout', `DevDigest API did not respond within ${opts.timeoutMs} ms.`);
      }
      const cause = err instanceof Error ? err.message : String(err);
      throw new ApiError('unreachable', `Cannot reach DevDigest API: ${cause}`);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      if (call?.signal?.aborted) throw new ApiError('aborted', 'Request was cancelled.');
      throw new ApiError('timeout', `DevDigest API did not finish responding within ${opts.timeoutMs} ms.`);
    }
    if (text.length > MAX_BODY_CHARS) {
      throw new ApiError('invalid_response', 'API response too large.', res.status);
    }

    if (!res.ok) {
      throw new ApiError(errorKindForStatus(res.status), messageFromBody(text, res.status), res.status);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ApiError('invalid_response', 'API returned a non-JSON response.', res.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const where = parsed.error.issues[0]?.path.join('.') || 'root';
      throw new ApiError('invalid_response', `API response did not match the expected shape (at ${where}).`, res.status);
    }
    return parsed.data;
  }

  const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

  return {
    listAgents: (o) => request('GET', '/agents', AgentList, o),
    resolveRepo: (repo, o) => request('GET', `/repos/resolve?${qs({ repo })}`, ResolvedRepoRef, o),
    reviewByRef: (body, o) => request('POST', '/reviews/by-ref', ReviewByRefResponse, o, body),
    getRun: (runId, o) => request('GET', `/runs/${encodeURIComponent(runId)}`, RunDetail, o),
    latestReview: (repo, pr, o) =>
      request('GET', `/reviews/latest?${qs({ repo, pr: String(pr) })}`, RunDetailList, o),
    getConventions: (repoId, o) =>
      request('GET', `/repos/${encodeURIComponent(repoId)}/conventions`, ConventionsPage, o),
    resolvePull: (repo, pr, o) =>
      request('GET', `/pulls/resolve?${qs({ repo, pr: String(pr) })}`, ResolvedPullRef, o),
    getBlast: (prId, o) =>
      request('GET', `/pulls/${encodeURIComponent(prId)}/blast`, BlastRadiusResponse, o),
  };
}
