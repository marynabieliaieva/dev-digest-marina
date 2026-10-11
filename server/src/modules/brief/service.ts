import { PrBrief, type BlastRadiusResponse, type Intent, type PrBriefResponse } from '@devdigest/shared';
import {
  BRIEF_TOKEN_BUDGET,
  buildBriefPrompt,
  generateBrief,
  newSideRanges,
  validateBriefOutput,
} from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { IntentService } from '../intent/service.js';
import { extractIntentLinks } from '../intent/helpers.js';
import { BlastService } from '../blast/service.js';
import { classifyFile } from '../smart-diff/helpers.js';
import { ProjectContextService, type WorkspaceDoc } from '../project-context/service.js';
import { BriefRepository, type BriefPullInfo } from './repository.js';
import { buildDataGaps, flattenCallers, toBriefFailure, type BriefLog } from './helpers.js';
import { BRIEF_CALL } from './constants.js';

/**
 * Per-PR generation lock, shared by every service instance (single process).
 * Never `await` between `has` and `set`.
 */
const locks = new Map<string, Promise<unknown>>();

/**
 * Brief service — assembles facts for a PR, makes one structured LLM call via
 * reviewer-core and persists the validated result. Every fact source degrades
 * to a data gap; only the model step can fail the request.
 */
export class BriefService {
  private repo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /** DB only: the stored brief, plus staleness and whether a generation is running. */
  async get(workspaceId: string, prId: string): Promise<PrBriefResponse> {
    const pull = await this.requirePull(workspaceId, prId);
    return this.respond(pull, await this.repo.getBrief(pull.id));
  }

  async generate(
    workspaceId: string,
    prId: string,
    mode: 'refresh' | 'if_stale',
    log: BriefLog,
  ): Promise<PrBriefResponse> {
    const pull = await this.requirePull(workspaceId, prId);
    if (mode === 'if_stale') {
      const existing = await this.repo.getBrief(pull.id);
      if (existing && existing.head_sha === pull.headSha) return this.respond(pull, existing);
    }

    if (locks.has(pull.id)) {
      throw new AppError('brief_in_progress', 'A brief is already being generated for this PR', 409);
    }
    const run = this.run(workspaceId, pull, log);
    locks.set(pull.id, run);
    try {
      await run;
    } finally {
      locks.delete(pull.id);
    }
    return this.get(workspaceId, prId);
  }

  // ------------------------------------------------------------------ private

  private respond(pull: BriefPullInfo, brief: PrBrief | null): PrBriefResponse {
    return {
      pr_id: pull.id,
      current_head_sha: pull.headSha,
      brief,
      stale: brief != null && brief.head_sha !== pull.headSha,
      generating: locks.has(pull.id),
    };
  }

  private async requirePull(workspaceId: string, prId: string): Promise<BriefPullInfo> {
    const pull = await this.repo.getPullForWorkspace(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }

  private async run(workspaceId: string, pull: BriefPullInfo, log: BriefLog): Promise<void> {
    // ---- model (the only step that maps to missing_key) ----
    let choice;
    let llm;
    try {
      choice = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      llm = await this.container.llm(choice.provider);
    } catch (err) {
      throw toBriefFailure(err, 'model_resolve');
    }

    // ---- facts: each source degrades to a data gap ----
    const headSha = pull.headSha;
    const files = await this.repo.listPrFiles(pull.id);

    let intent: Intent | null = null;
    let intentFacts: { status: 'ready' | 'failed'; stale: boolean } | null = null;
    try {
      const rec = (await new IntentService(this.container).get(workspaceId, pull.id)).intent;
      if (rec) {
        intentFacts = { status: rec.status, stale: rec.stale };
        if (rec.status === 'ready') {
          intent = {
            summary: rec.summary,
            in_scope: rec.in_scope,
            out_of_scope: rec.out_of_scope,
            risk_areas: rec.risk_areas,
            confidence: rec.confidence,
            missing_context: rec.missing_context,
            sources: rec.sources,
          };
        }
      }
    } catch {
      intentFacts = null;
    }

    let blastRes: BlastRadiusResponse | null = null;
    try {
      blastRes = await BlastService.fromContainer(this.container).getBlast(workspaceId, pull.id);
    } catch {
      blastRes = null;
    }

    let linkedIssue: { ref: string; title: string; body: string } | null = null;
    let hasLink = false;
    try {
      const link = extractIntentLinks(pull.body ?? '', pull.repo).find(
        (l) => l.kind === 'linked_issue' && l.target.type === 'issue' && !l.skipped,
      );
      if (link && link.target.type === 'issue') {
        hasLink = true;
        const gh = await this.container.github();
        const issue = await gh.getIssue(pull.repo, link.target.number);
        linkedIssue = { ref: link.ref, title: issue.title, body: issue.body ?? '' };
      }
    } catch {
      linkedIssue = null;
    }

    let collected: { clone: boolean; docs: WorkspaceDoc[] } = { clone: false, docs: [] };
    try {
      collected = await new ProjectContextService(this.container).collectWorkspaceDocs(
        workspaceId,
        pull.repoId,
      );
    } catch {
      collected = { clone: false, docs: [] };
    }
    const okDocs = collected.docs.filter((d) => d.status === 'ok' && d.content !== null);

    const gaps = buildDataGaps({
      prBody: pull.body,
      intent: intentFacts,
      blast: blastRes ? { degraded: blastRes.degraded, reason: blastRes.reason } : null,
      linkedIssue: { hasLink, fetched: linkedIssue !== null },
      specs: collected,
    });

    // ---- prompt ----
    const blast = blastRes?.blast ?? null;
    const allCallers = flattenCallers(blast);
    const prompt = buildBriefPrompt({
      title: pull.title,
      body: pull.body ?? '',
      intent,
      intentStale: intentFacts?.stale ?? false,
      files: files.map((f) => ({ ...f, role: classifyFile(f.path) })),
      blast:
        blastRes && blast
          ? { summary: blast.summary, degraded: blastRes.degraded, reason: blastRes.reason, callers: allCallers }
          : null,
      linkedIssue,
      specs: okDocs.map((d) => ({ path: d.path, content: d.content ?? '' })),
      gapNotes: gaps.map((g) => `${g.source} (${g.status}): ${g.reason}`),
    });

    log.tool(`brief: request — provider=${choice.provider} model=${choice.model} ~${prompt.estTokens} tok`, {
      call: BRIEF_CALL,
      provider: choice.provider,
      model: choice.model,
      sections: prompt.inputs.map((s) => ({
        name: s.name,
        ref: s.ref,
        status: s.status,
        est_tokens: s.est_tokens,
      })),
      est_tokens: prompt.estTokens,
      budget: BRIEF_TOKEN_BUDGET,
    });

    // ---- the single model call ----
    const t0 = Date.now();
    let res;
    try {
      res = await generateBrief({ llm, model: choice.model, messages: prompt.messages });
    } catch (err) {
      const failure = toBriefFailure(err, 'model_call');
      log.error(`brief: failed — ${failure.message}`, { call: BRIEF_CALL, error: failure.message });
      throw failure;
    }

    // ---- validate against the real PR files / full blast snapshot ----
    const callerLines = new Map<string, Set<number>>();
    for (const c of allCallers) {
      let set = callerLines.get(c.file);
      if (!set) callerLines.set(c.file, (set = new Set()));
      set.add(c.line);
    }
    const validated = validateBriefOutput(res.output, {
      prFiles: new Map(files.map((f) => [f.path, newSideRanges(f.patch)])),
      blastFiles: new Set([...allCallers.map((c) => c.file), ...(blast?.changed_symbols.map((s) => s.file) ?? [])]),
      callerLines,
    });

    const inputs = [
      ...prompt.inputs,
      ...collected.docs
        .filter((d) => d.status !== 'ok')
        .map((d) => ({
          name: 'specs' as const,
          ref: d.path,
          status: d.status as 'missing' | 'too_large' | 'unreadable',
          est_tokens: 0,
        })),
    ];

    const brief = PrBrief.parse({
      intent,
      blast,
      risks: { risks: validated.risks },
      history: { history: [] },
      summary: validated.summary,
      review_focus: validated.review_focus,
      head_sha: headSha,
      generated_at: new Date().toISOString(),
      provider: choice.provider,
      model: choice.model,
      tokens_in: res.tokensIn,
      tokens_out: res.tokensOut,
      cost_usd: res.costUsd,
      attempts: res.attempts,
      data_gaps: [...gaps, ...prompt.budgetGaps],
      inputs,
      dropped: validated.dropped,
    });
    await this.repo.upsertBrief(pull.id, brief);

    log.tool(
      `brief: response — tokens=${res.tokensIn}/${res.tokensOut} cost=${res.costUsd ?? 'n/a'} attempts=${res.attempts}`,
      {
        call: BRIEF_CALL,
        tokens_in: res.tokensIn,
        tokens_out: res.tokensOut,
        cost_usd: res.costUsd,
        attempts: res.attempts,
        duration_ms: Date.now() - t0,
        dropped: validated.dropped,
      },
    );
  }
}
