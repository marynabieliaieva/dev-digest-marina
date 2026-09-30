import type {
  GitHubClient,
  IntentSource,
  PrIntentRecord,
  PrIntentResponse,
  PromptSectionStat,
  UnifiedDiff,
} from '@devdigest/shared';
import {
  buildIntentPrompt,
  classifyIntent,
  finalizeIntent,
  outlineFromDiff,
  outlineFromPatches,
  renderIntentBlock,
  type IntentDoc,
} from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentRepository, type IntentPullInfo, type IntentUpsert } from './repository.js';
import {
  extractIntentLinks,
  formatCompositionMsg,
  safeRef,
  scrubText,
  sha7,
  toPrIntentRecord,
  type IntentLink,
  type IntentLog,
} from './helpers.js';
import { MAX_BODY_CHARS, MAX_DOC_CHARS, MAX_DOCS_TOTAL_CHARS, MAX_TITLE_CHARS } from './constants.js';

/**
 * Intent service — derives, persists and serves a PR's intent (summary, scope,
 * risk areas, sources). All external I/O goes through container ports
 * (`github()`, `webFetcher`, `llm()`); all DB access through `IntentRepository`.
 *
 * Untrusted input (PR title/body, linked docs) goes ONLY into the classifier
 * prompt. Doc text is never persisted or logged — only stats (chars, sha256).
 */

/** Structural inputs (satisfied by the reviews module's row types without importing them). */
export interface IntentPullInput {
  id: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
}
export interface IntentRepoInput {
  owner: string;
  name: string;
}

export interface EnsuredIntent {
  record: PrIntentRecord;
  /** Pre-rendered `Derived intent` text for the review prompt. */
  block: string;
  filterEnabled: boolean;
}

interface FetchedText {
  status: 'used' | 'truncated' | 'unavailable' | 'unsupported';
  reason: string | null;
  text: string;
}

const SKIPPED_REASON = 'more than the maximum number of links; not fetched';

function trimTo(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

export class IntentService {
  private repo: IntentRepository;

  constructor(private container: Container) {
    this.repo = new IntentRepository(container.db);
  }

  /** The stored intent for a PR (or `intent: null`), with `stale` computed now. */
  async get(workspaceId: string, prId: string): Promise<PrIntentResponse> {
    const pull = await this.requirePull(workspaceId, prId);
    const row = await this.repo.getIntent(pull.id);
    return {
      pr_id: pull.id,
      current_head_sha: pull.headSha,
      intent: row ? toPrIntentRecord(row, pull.headSha) : null,
    };
  }

  /**
   * Always re-derives. `diff` is present only on the review path. A derivation
   * failure is never thrown: it is persisted as `status: 'failed'` unless a
   * previous `ready` intent exists, which is then kept untouched.
   */
  async derive(
    workspaceId: string,
    prId: string,
    opts: { log: IntentLog; diff?: UnifiedDiff },
  ): Promise<PrIntentRecord> {
    const pull = await this.requirePull(workspaceId, prId);
    return this.deriveForPull(workspaceId, pull, opts.log, opts.diff);
  }

  /**
   * Review-path entry: derive when the row is missing or stale, reuse a fresh
   * one. Returns null (no intent block, no scope filter) when there is no usable
   * intent. NEVER throws — intent must not block a review.
   */
  async ensureForReview(
    workspaceId: string,
    pull: IntentPullInput,
    repo: IntentRepoInput,
    diff: UnifiedDiff,
    log: IntentLog,
  ): Promise<EnsuredIntent | null> {
    try {
      const info: IntentPullInfo = { ...pull, repo: { owner: repo.owner, name: repo.name } };
      const existing = await this.repo.getIntent(pull.id);
      let record: PrIntentRecord;
      if (!existing) {
        record = await this.deriveForPull(workspaceId, info, log, diff);
      } else {
        const cached = toPrIntentRecord(existing, pull.headSha);
        if (cached.status === 'failed') {
          // A previous derivation failed (e.g. missing key, provider outage) —
          // retry on every review instead of caching the failure.
          log.info(`intent: previous derivation failed — retrying`, {
            call: 'intent_cache',
            stale: cached.stale,
            head_sha: existing.headSha,
          });
          record = await this.deriveForPull(workspaceId, info, log, diff);
        } else if (cached.stale) {
          log.info(
            `intent: stale (derived for ${sha7(existing.headSha)}, head ${sha7(pull.headSha)}) — re-deriving`,
            { call: 'intent_cache', stale: true, head_sha: existing.headSha },
          );
          record = await this.deriveForPull(workspaceId, info, log, diff);
        } else {
          log.info(`intent: using cached intent (derived for ${sha7(existing.headSha)})`, {
            call: 'intent_cache',
            stale: false,
            head_sha: existing.headSha,
          });
          record = cached;
        }
      }
      if (record.status !== 'ready') return null;
      return {
        record,
        block: renderIntentBlock(record),
        filterEnabled: !record.stale && record.confidence !== 'low' && record.in_scope.length > 0,
      };
    } catch (err) {
      log.error(`intent: failed — ${scrubText((err as Error).message)}`, { call: 'intent_classifier' });
      return null;
    }
  }

  // ------------------------------------------------------------------ private

  private async requirePull(workspaceId: string, prId: string): Promise<IntentPullInfo> {
    const pull = await this.repo.getPullForWorkspace(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async deriveForPull(
    workspaceId: string,
    pull: IntentPullInfo,
    log: IntentLog,
    diff?: UnifiedDiff,
  ): Promise<PrIntentRecord> {
    const sources: IntentSource[] = [];
    let composition: PromptSectionStat[] = [];
    let provider: string | null = null;
    let model: string | null = null;

    try {
      // ---- local sources: title, body, file outline (no I/O beyond the DB) ----
      const title = trimTo(pull.title.trim(), MAX_TITLE_CHARS);
      sources.push(this.localSource('pr_title', 'title', title.truncated ? 'truncated' : 'used', null));

      const rawBody = (pull.body ?? '').trim();
      const body = trimTo(rawBody, MAX_BODY_CHARS);
      sources.push(
        rawBody
          ? this.localSource('pr_body', 'description', body.truncated ? 'truncated' : 'used', null)
          : this.localSource('pr_body', 'description', 'unavailable', 'PR description is empty'),
      );

      const outline = diff
        ? outlineFromDiff(diff)
        : outlineFromPatches(await this.repo.listPrFileOutlineInputs(pull.id));
      sources.push(this.localSource('file_outline', 'changed files', 'used', null));

      // ---- resolve the model up front: a missing key fails before any fetching ----
      const choice = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
      provider = choice.provider;
      model = choice.model;
      const llm = await this.container.llm(choice.provider);

      // ---- linked sources ----
      const links = extractIntentLinks(rawBody, pull.repo);
      const docs = await this.resolveLinks(pull, links, sources);

      const notes = sources
        .filter((s) => s.status === 'unavailable' || s.status === 'unsupported' || s.status === 'skipped')
        .map((s) => `${s.ref} (${s.status}): ${s.reason ?? 'no reason given'}`);

      const prompt = buildIntentPrompt({
        title: title.text,
        body: body.text,
        outline,
        docs,
        notes,
      });
      composition = prompt.composition;
      this.applyCompositionToSources(sources, composition);

      const requestData = {
        call: 'intent_classifier',
        provider,
        model,
        sections: composition,
        total_chars: composition.reduce((n, s) => n + s.chars, 0),
        est_tokens: composition.reduce((n, s) => n + s.est_tokens, 0),
        sources: sources.map((s) => ({
          kind: s.kind,
          ref: s.ref,
          status: s.status,
          chars: s.chars,
          sha256: s.sha256,
        })),
      };
      log.tool(formatCompositionMsg('intent: classifier request', provider, model, composition), requestData);

      const t0 = Date.now();
      const res = await classifyIntent({ llm, model: choice.model, prompt });
      const intent = finalizeIntent(res.output, sources);

      log.tool(
        `intent: classifier response — tokens=${res.tokensIn}/${res.tokensOut} cost=${
          res.costUsd === null ? 'n/a' : res.costUsd
        } attempts=${res.attempts} confidence=${intent.confidence} missing=${intent.missing_context.length}`,
        {
          call: 'intent_classifier',
          provider,
          model,
          tokens_in: res.tokensIn,
          tokens_out: res.tokensOut,
          cost_usd: res.costUsd,
          attempts: res.attempts,
          duration_ms: Date.now() - t0,
          confidence: intent.confidence,
          missing_context_count: intent.missing_context.length,
        },
      );

      const stored = await this.repo.upsertIntent(pull.id, {
        summary: intent.summary,
        inScope: intent.in_scope,
        outOfScope: intent.out_of_scope,
        riskAreas: intent.risk_areas,
        confidence: intent.confidence,
        missingContext: intent.missing_context,
        sources: intent.sources,
        composition,
        status: 'ready',
        error: null,
        headSha: pull.headSha,
        provider,
        model,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut,
        costUsd: res.costUsd,
      });
      return toPrIntentRecord(stored, pull.headSha);
    } catch (err) {
      const error = scrubText((err as Error).message);
      log.error(`intent: classifier failed — ${error}`, { call: 'intent_classifier', provider, model, error });
      const failed: IntentUpsert = {
        summary: '',
        inScope: [],
        outOfScope: [],
        riskAreas: [],
        confidence: 'low',
        missingContext: [],
        sources,
        composition,
        status: 'failed',
        error,
        headSha: pull.headSha,
        provider,
        model,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
      };
      // Keep a previously good intent as-is (plan: "the old row is kept"); only
      // record the failure when there is nothing better to show.
      const previous = await this.repo.getIntent(pull.id).catch(() => null);
      if (previous && previous.status === 'ready') {
        return toPrIntentRecord(
          { ...previous, ...failed, derivedAt: previous.derivedAt },
          pull.headSha,
        );
      }
      return toPrIntentRecord(await this.repo.upsertIntent(pull.id, failed), pull.headSha);
    }
  }

  private localSource(
    kind: 'pr_title' | 'pr_body' | 'file_outline',
    ref: string,
    status: IntentSource['status'],
    reason: string | null,
  ): IntentSource {
    return { kind, ref, status, chars: 0, sha256: null, reason };
  }

  /** chars/sha256 come from the prompt composition — single source of truth, no text kept. */
  private applyCompositionToSources(sources: IntentSource[], composition: PromptSectionStat[]): void {
    const byName = new Map(composition.map((c) => [c.name, c]));
    for (const s of sources) {
      const name = s.kind === 'pr_title' || s.kind === 'pr_body' || s.kind === 'file_outline' ? s.kind : `${s.kind}:${s.ref}`;
      const stat = byName.get(name);
      if (!stat || (s.status !== 'used' && s.status !== 'truncated')) continue;
      s.chars = stat.chars;
      s.sha256 = stat.sha256;
    }
  }

  /** Fetch each live link (never throws); pushes one source per link, returns the doc texts for the prompt. */
  private async resolveLinks(
    pull: IntentPullInfo,
    links: IntentLink[],
    sources: IntentSource[],
  ): Promise<IntentDoc[]> {
    const docs: IntentDoc[] = [];
    let remaining = MAX_DOCS_TOTAL_CHARS;
    let github: GitHubClient | null | undefined;
    const getGithub = async (): Promise<GitHubClient | null> => {
      if (github === undefined) {
        try {
          github = await this.container.github();
        } catch {
          github = null;
        }
      }
      return github;
    };

    for (const link of links) {
      const base = { kind: link.kind, ref: safeRef(link.ref), chars: 0, sha256: null } as const;
      if (link.skipped) {
        sources.push({ ...base, status: 'skipped', reason: SKIPPED_REASON });
        continue;
      }
      if (link.target.type === 'unsupported') {
        sources.push({ ...base, status: 'unsupported', reason: link.target.reason });
        continue;
      }
      if (remaining <= 0) {
        sources.push({ ...base, status: 'skipped', reason: 'linked document budget exhausted' });
        continue;
      }
      const fetched = await this.fetchLink(pull, link, getGithub);
      if (fetched.status === 'unavailable' || fetched.status === 'unsupported') {
        sources.push({ ...base, status: fetched.status, reason: fetched.reason });
        continue;
      }
      const capped = trimTo(fetched.text, Math.min(MAX_DOC_CHARS, remaining));
      if (!capped.text.trim()) {
        sources.push({ ...base, status: 'unavailable', reason: 'document is empty' });
        continue;
      }
      remaining -= capped.text.length;
      sources.push({
        ...base,
        status: capped.truncated || fetched.status === 'truncated' ? 'truncated' : 'used',
        reason: null,
      });
      docs.push({ kind: link.kind, ref: safeRef(link.ref), text: capped.text });
    }
    return docs;
  }

  private async fetchLink(
    pull: IntentPullInfo,
    link: IntentLink,
    getGithub: () => Promise<GitHubClient | null>,
  ): Promise<FetchedText> {
    const target = link.target;
    try {
      if (target.type === 'issue') {
        const gh = await getGithub();
        if (!gh) return { status: 'unavailable', reason: 'GitHub not configured', text: '' };
        const issue = await gh.getIssue(pull.repo, target.number);
        return {
          status: 'used',
          reason: null,
          text: `${issue.title} (${issue.state})\n\n${issue.body ?? ''}`,
        };
      }
      if (target.type === 'repo_file') {
        const gh = await getGithub();
        if (!gh) return { status: 'unavailable', reason: 'GitHub not configured', text: '' };
        const file = await gh.getFileContent(pull.repo, target.path, target.gitRef ?? pull.headSha);
        return { status: 'used', reason: null, text: file.text };
      }
      if (target.type === 'url') {
        if (!this.container.config.intentExternalFetch) {
          return { status: 'unsupported', reason: 'external fetch disabled', text: '' };
        }
        const doc = await this.container.webFetcher.fetchText(target.url);
        return { status: 'used', reason: null, text: doc.text };
      }
      return { status: 'unsupported', reason: 'unsupported link', text: '' };
    } catch (err) {
      return { status: 'unavailable', reason: scrubText((err as Error).message) || 'fetch failed', text: '' };
    }
  }
}
