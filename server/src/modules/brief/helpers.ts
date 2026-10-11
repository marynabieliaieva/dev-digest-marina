import type { BlastCaller, BlastRadius, DataGap } from '@devdigest/shared';
import { AppError, ConfigError } from '../../platform/errors.js';
import { scrubText } from '../intent/helpers.js';

/** Pure helpers for the brief module: failure classification, data gaps, blast flattening, logging. */

// ------------------------------------------------------------------ logging

/** Sink the service logs through; routes pass an adapter over `req.log`. */
export interface BriefLog {
  tool(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

type PinoLog = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export function pinoBriefLog(log: PinoLog): BriefLog {
  const emit = (fn: PinoLog['info'], msg: string, data?: unknown) =>
    fn(data !== undefined ? { data } : {}, msg);
  return {
    tool: (m, d) => emit(log.info.bind(log), m, d),
    error: (m, d) => emit(log.error.bind(log), m, d),
  };
}

// ------------------------------------------------------------------ failures

export type BriefFailureReason = 'missing_key' | 'provider_error' | 'schema_invalid';

/**
 * Map an error from the model step to the API error. `missing_key` only for a
 * ConfigError while resolving the model/provider; `schema_invalid` when the
 * adapter reports a schema-validation failure; anything else is `provider_error`.
 * The message is scrubbed; raw output and original details are never included.
 */
export function toBriefFailure(err: unknown, phase: 'model_resolve' | 'model_call'): AppError {
  const message = err instanceof Error ? err.message : String(err);
  let reason: BriefFailureReason = 'provider_error';
  if (phase === 'model_resolve' && err instanceof ConfigError) reason = 'missing_key';
  else if (phase === 'model_call' && /failed schema validation/i.test(message)) reason = 'schema_invalid';
  return new AppError('brief_generation_failed', scrubText(message), 502, { reason });
}

// ---------------------------------------------------------------- data gaps

export interface GapFacts {
  prBody: string | null;
  /** null = no intent row (or it could not be read). */
  intent: { status: 'ready' | 'failed'; stale: boolean } | null;
  /** null = blast could not be computed at all. */
  blast: { degraded: boolean; reason: string | null } | null;
  linkedIssue: { hasLink: boolean; fetched: boolean };
  specs: { clone: boolean; docs: Array<{ status: string }> };
}

export function buildDataGaps(f: GapFacts): DataGap[] {
  const gaps: DataGap[] = [];
  if (!f.prBody || !f.prBody.trim()) {
    gaps.push({ source: 'pr_description', status: 'missing', reason: 'PR description is empty' });
  }
  if (!f.intent) {
    gaps.push({ source: 'intent', status: 'missing', reason: 'no derived intent for this PR' });
  } else if (f.intent.status === 'failed') {
    gaps.push({ source: 'intent', status: 'missing', reason: 'intent derivation failed' });
  } else if (f.intent.stale) {
    gaps.push({ source: 'intent', status: 'stale', reason: 'intent was derived for an earlier commit' });
  }
  if (!f.blast) {
    gaps.push({ source: 'blast_radius', status: 'missing', reason: 'blast radius unavailable' });
  } else if (f.blast.degraded) {
    gaps.push({
      source: 'blast_radius',
      status: 'degraded',
      reason: f.blast.reason ? `blast radius degraded: ${f.blast.reason}` : 'blast radius degraded',
    });
  }
  if (!f.linkedIssue.hasLink) {
    gaps.push({ source: 'linked_issue', status: 'missing', reason: 'no linked issue in the PR description' });
  } else if (!f.linkedIssue.fetched) {
    gaps.push({ source: 'linked_issue', status: 'missing', reason: 'linked issue could not be fetched' });
  }
  if (!f.specs.clone) {
    gaps.push({ source: 'specs', status: 'missing', reason: 'repository is not cloned' });
  } else if (f.specs.docs.length === 0) {
    gaps.push({ source: 'specs', status: 'missing', reason: 'no attached documents' });
  } else if (!f.specs.docs.some((d) => d.status === 'ok')) {
    gaps.push({ source: 'specs', status: 'missing', reason: 'no attached document could be read' });
  }
  return gaps;
}

// -------------------------------------------------------------------- blast

/** All callers of all downstream entries (the FULL snapshot, not the capped prompt list). */
export function flattenCallers(blast: BlastRadius | null): BlastCaller[] {
  return blast ? blast.downstream.flatMap((d) => d.callers) : [];
}
