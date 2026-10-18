import type {
  EvalBatch,
  EvalBatchDetail,
  EvalCaseDto,
  EvalCompare,
  EvalConfigSnapshot,
  EvalDashboard,
  EvalRunAllResult,
  EvalRunRecord,
  EvalRunStarted,
  EvalTrendPoint,
  EvalWorkspaceDashboard,
  AgentEvalSummary,
  Provider,
} from '@devdigest/shared';
import { EvalExpectation } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { renderSkillBlocks, selectActiveSkills } from '../reviews/helpers.js';
import { toSkillDto } from '../skills/helpers.js';
import { EvalExecutor, type EvalJob, type EvalLog } from './executor.js';
import { evalQueue, type EvalQueue } from './queue.js';
import {
  isUniqueViolation,
  EvalRepository,
  type EvalBatchRow,
  type EvalCaseRow,
  type EvalRunRow,
} from './repository.js';
import { buildAlert, compareDelta, isStaleBatch, promptDiff } from './helpers.js';
import {
  buildCaseName,
  buildExpectation,
  buildInputMeta,
  checkSectionSize,
  sliceFileSection,
} from './frozen-input.js';

const STALE_ERROR = 'stale: run did not finish';
const NOOP_LOG: EvalLog = { info: () => undefined, error: () => undefined };

const MAX_AGENT_BATCHES = 50;
const SPARKLINE_POINTS = 10;
const RECENT_WORKSPACE_BATCHES = 20;
const RECENT_RUNS = 20;

/** Eval orchestration: case creation, batch start (queued), reads, dashboards, compare. */
export class EvalService {
  private repo: EvalRepository;
  private executor: EvalExecutor;

  constructor(
    private container: Container,
    private logger: EvalLog = NOOP_LOG,
    private queue: EvalQueue = evalQueue,
  ) {
    this.repo = new EvalRepository(container.db);
    this.executor = new EvalExecutor({
      repo: this.repo,
      resolveLlm: (provider: Provider) => container.llm(provider),
      logger,
      now: () => new Date(),
    });
  }

  // ---- cases --------------------------------------------------------------

  async createCase(workspaceId: string, findingId: string): Promise<EvalCaseDto> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    const decision = finding.acceptedAt ? 'accepted' : finding.dismissedAt ? 'dismissed' : null;
    const decidedAt = finding.acceptedAt ?? finding.dismissedAt;
    if (!decision || !decidedAt) {
      throw new AppError('finding_undecided', 'Accept or dismiss the finding first', 422);
    }

    const agent = review.agentId
      ? await this.container.agentsRepo.getById(workspaceId, review.agentId)
      : undefined;
    if (!agent) {
      throw new AppError('agent_missing', 'The agent that produced this finding no longer exists', 422);
    }

    const existing = await this.repo.findCaseBySource(agent.id, finding.id);
    if (existing) throw alreadyEvalCase(existing.id);

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');
    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);
    const section = sliceFileSection(diff.raw, finding.file);
    if (section === null) {
      throw new AppError('file_not_in_diff', `${finding.file} has no changes in this pull request's diff`, 422);
    }
    if (checkSectionSize(section)) {
      throw new AppError('diff_too_large', `The diff for ${finding.file} is too large to freeze`, 422);
    }

    const expectation = buildExpectation(finding, decision);
    let row: EvalCaseRow;
    try {
      row = await this.repo.insertCase({
        workspaceId,
        agentId: agent.id,
        name: buildCaseName(expectation.type, finding.title),
        inputDiff: section,
        inputMeta: buildInputMeta(
          pull,
          { fullName: `${repoRow.owner}/${repoRow.name}` },
          { id: review.id, runId: review.runId },
          finding,
          decision,
          decidedAt,
        ),
        expectedOutput: expectation,
        sourceFindingId: finding.id,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.repo.findCaseBySource(agent.id, finding.id);
      if (raced) throw alreadyEvalCase(raced.id);
      throw err;
    }
    return caseToDto(row, null, true);
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseDto[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.repo.listCases(workspaceId, agentId);
    const last = await this.repo.lastRunsByCase(rows.map((r) => r.id));
    return rows.map((r) => caseToDto(r, last.get(r.id) ?? null, false));
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseDto> {
    const row = await this.requireCase(workspaceId, id);
    const last = await this.repo.lastRunsByCase([row.id]);
    return caseToDto(row, last.get(row.id) ?? null, true);
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    const row = await this.requireCase(workspaceId, id);
    await this.sweepStale(row.ownerId);
    const [running] = await this.repo.runningBatches(row.ownerId);
    if (running) throw batchRunning(running);
    await this.repo.deleteCase(workspaceId, id);
  }

  // ---- starting runs ------------------------------------------------------

  async startAgentRun(workspaceId: string, agentId: string): Promise<EvalRunStarted> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.assertNoRunning(agent.id);
    const cases = await this.repo.listCases(workspaceId, agent.id);
    if (cases.length === 0) throw new AppError('no_eval_cases', 'This agent has no eval cases yet', 422);
    return this.startBatch(workspaceId, agent, 'set', cases);
  }

  async startCaseRun(workspaceId: string, caseId: string): Promise<EvalRunStarted> {
    const row = await this.requireCase(workspaceId, caseId);
    const agent = await this.container.agentsRepo.getById(workspaceId, row.ownerId);
    if (!agent) throw new NotFoundError('Eval case not found');
    await this.assertNoRunning(agent.id);
    return this.startBatch(workspaceId, agent, 'case', [row]);
  }

  async runAll(workspaceId: string): Promise<EvalRunAllResult> {
    const agents = sortByName(await this.container.agentsRepo.list(workspaceId));
    const counts = await this.repo.caseCountsByAgent(workspaceId);
    await this.sweepWorkspace(workspaceId);
    const result: EvalRunAllResult = { started: [], skipped: [] };
    for (const agent of agents) {
      if (!agent.enabled) {
        result.skipped.push({ agent_id: agent.id, reason: 'disabled' });
        continue;
      }
      if ((counts.get(agent.id) ?? 0) === 0) {
        result.skipped.push({ agent_id: agent.id, reason: 'no_cases' });
        continue;
      }
      if ((await this.repo.runningBatches(agent.id)).length > 0) {
        result.skipped.push({ agent_id: agent.id, reason: 'running' });
        continue;
      }
      try {
        const cases = await this.repo.listCases(workspaceId, agent.id);
        const { batch_id } = await this.startBatch(workspaceId, agent, 'set', cases);
        result.started.push({ agent_id: agent.id, batch_id });
      } catch (err) {
        if (err instanceof AppError && err.code === 'batch_running') {
          result.skipped.push({ agent_id: agent.id, reason: 'running' });
          continue;
        }
        throw err;
      }
    }
    return result;
  }

  // ---- batch reads --------------------------------------------------------

  async listBatches(workspaceId: string, agentId: string): Promise<EvalBatch[]> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.sweepStale(agent.id);
    const rows = await this.repo.listBatches(agent.id, { scope: 'set', limit: MAX_AGENT_BATCHES });
    return rows.map((r) => batchToDto(r, agent.name, false));
  }

  async getBatch(workspaceId: string, batchId: string): Promise<EvalBatchDetail> {
    let row = await this.repo.getBatch(workspaceId, batchId);
    if (!row) throw new NotFoundError('Eval run not found');
    if (await this.sweepStale(row.agentId)) row = (await this.repo.getBatch(workspaceId, batchId)) ?? row;
    const agent = await this.container.agentsRepo.getById(workspaceId, row.agentId);
    const runs = await this.repo.listRuns(row.id);
    return {
      ...batchToDto(row, agent?.name ?? '', true),
      runs: runs.map(runToDto),
      config_snapshot: row.configSnapshot as EvalConfigSnapshot,
    };
  }

  async compare(workspaceId: string, baseId: string, headId: string): Promise<EvalCompare> {
    const [base, head] = await Promise.all([
      this.repo.getBatch(workspaceId, baseId),
      this.repo.getBatch(workspaceId, headId),
    ]);
    if (!base || !head) throw new NotFoundError('Eval run not found');
    if (base.agentId !== head.agentId) {
      throw new AppError('different_agents', 'Runs belong to different agents', 422);
    }
    for (const b of [base, head]) {
      if (b.status !== 'done' || b.scope !== 'set') {
        throw new AppError('not_comparable', 'Only finished full-set runs can be compared', 422);
      }
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, base.agentId);
    const baseDto = batchToDto(base, agent?.name ?? '', true);
    const headDto = batchToDto(head, agent?.name ?? '', true);
    const bs = base.configSnapshot as EvalConfigSnapshot;
    const hs = head.configSnapshot as EvalConfigSnapshot;
    return {
      base: baseDto,
      head: headDto,
      delta: compareDelta(baseDto, headDto),
      prompt_diff: promptDiff(bs.system_prompt, hs.system_prompt),
      model_changed: bs.model !== hs.model || bs.provider !== hs.provider,
    };
  }

  // ---- dashboards ---------------------------------------------------------

  async agentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.requireAgent(workspaceId, agentId);
    await this.sweepStale(agent.id);

    const [done, recent, running, casesTotal] = await Promise.all([
      this.repo.listBatches(agent.id, { scope: 'set', status: 'done', limit: MAX_AGENT_BATCHES }),
      this.repo.listBatches(agent.id, { scope: 'set', limit: MAX_AGENT_BATCHES }),
      this.repo.runningBatches(agent.id),
      this.repo.countCases(agent.id),
    ]);
    const [latest, previous] = done;

    const delta = (key: 'recall' | 'precision' | 'citationAccuracy') =>
      latest && previous && latest[key] !== null && previous[key] !== null
        ? latest[key]! - previous[key]!
        : null;

    const recentRuns = await this.repo.recentRunsForBatches(
      done.slice(0, 5).map((b) => b.id),
      RECENT_RUNS,
    );

    return {
      owner_kind: 'agent',
      owner_id: agent.id,
      cases_total: casesTotal,
      current: latest
        ? {
            recall: latest.recall,
            precision: latest.precision,
            citation_accuracy: latest.citationAccuracy,
            traces_passed: latest.tracesPassed ?? 0,
            traces_total: latest.tracesTotal ?? 0,
            cost_usd: latest.costUsd,
          }
        : null,
      delta: {
        recall: delta('recall'),
        precision: delta('precision'),
        citation_accuracy: delta('citationAccuracy'),
      },
      trend: [...done].reverse().map(trendPoint),
      recent_runs: recentRuns.map(runToDto),
      recent_batches: recent.map((r) => batchToDto(r, agent.name, false)),
      // Only a running set batch drives "Run all evals"; a case-scope batch is followed by its row.
      running_batch_id: running.find((b) => b.scope === 'set')?.id ?? null,
      alert:
        latest && previous
          ? buildAlert(
              {
                agent_version: latest.agentVersion,
                recall: latest.recall,
                precision: latest.precision,
                citation_accuracy: latest.citationAccuracy,
              },
              {
                agent_version: previous.agentVersion,
                recall: previous.recall,
                precision: previous.precision,
                citation_accuracy: previous.citationAccuracy,
              },
            )
          : null,
    };
  }

  async workspaceDashboard(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    await this.sweepWorkspace(workspaceId);
    const agents = sortByName(await this.container.agentsRepo.list(workspaceId));
    const names = new Map(agents.map((a) => [a.id, a.name]));
    const [counts, running, doneBatches, recent] = await Promise.all([
      this.repo.caseCountsByAgent(workspaceId),
      this.repo.runningBatchesInWorkspace(workspaceId),
      this.repo.doneSetBatchesForAgents(
        agents.map((a) => a.id),
        SPARKLINE_POINTS,
      ),
      this.repo.recentSetBatches(workspaceId, RECENT_WORKSPACE_BATCHES),
    ]);
    const runningByAgent = new Map(running.map((b) => [b.agentId, b.id]));

    const rows: AgentEvalSummary[] = agents.map((a) => {
      const mine = doneBatches.filter((b) => b.agentId === a.id); // newest first
      return {
        agent_id: a.id,
        agent_name: a.name,
        model: a.model,
        enabled: a.enabled,
        cases_total: counts.get(a.id) ?? 0,
        last_batch: mine[0] ? batchToDto(mine[0], a.name, false) : null,
        sparkline: [...mine].reverse().map(passRate),
        running_batch_id: runningByAgent.get(a.id) ?? null,
      };
    });

    return {
      agents: rows,
      recent_batches: recent.map((b) => batchToDto(b, names.get(b.agentId) ?? '', false)),
    };
  }

  // ---- internals ----------------------------------------------------------

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async requireCase(workspaceId: string, id: string): Promise<EvalCaseRow> {
    const row = await this.repo.getCase(workspaceId, id);
    if (!row || row.ownerKind !== 'agent') throw new NotFoundError('Eval case not found');
    return row;
  }

  /** Fail running batches this process is neither executing nor queueing. Returns true if any. */
  private async sweepStale(agentId: string): Promise<boolean> {
    return this.failStale(await this.repo.runningBatches(agentId));
  }

  private async sweepWorkspace(workspaceId: string): Promise<boolean> {
    return this.failStale(await this.repo.runningBatchesInWorkspace(workspaceId));
  }

  private async failStale(running: EvalBatchRow[]): Promise<boolean> {
    const now = new Date();
    const live = this.queue.liveIds();
    const stale = running.filter((b) => isStaleBatch(b, now, live)).map((b) => b.id);
    await this.repo.failStale(stale, STALE_ERROR, now);
    return stale.length > 0;
  }

  private async assertNoRunning(agentId: string): Promise<void> {
    await this.sweepStale(agentId);
    const [running] = await this.repo.runningBatches(agentId);
    if (running) throw batchRunning(running);
  }

  private async startBatch(
    workspaceId: string,
    agent: AgentRow,
    scope: 'set' | 'case',
    cases: EvalCaseRow[],
  ): Promise<EvalRunStarted> {
    const config = await this.buildSnapshot(agent);
    // Oldest first so a set run reads in the order the cases were created.
    const ordered = [...cases].reverse();

    let batch: EvalBatchRow;
    try {
      batch = await this.repo.insertBatch({
        workspaceId,
        agentId: agent.id,
        scope,
        agentVersion: agent.version,
        configSnapshot: config,
        casesTotal: ordered.length,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [running] = await this.repo.runningBatches(agent.id);
      if (running) throw batchRunning(running);
      throw err;
    }

    const job: EvalJob = {
      batchId: batch.id,
      agentName: agent.name,
      agentVersion: agent.version,
      startedAt: batch.startedAt,
      config,
      cases: ordered.map(toJobCase),
    };
    this.queue.enqueue(batch.id, () => this.executor.run(job));
    return { batch_id: batch.id };
  }

  /** Freeze what the run will use: model config plus the enabled skills as rendered into the prompt. */
  private async buildSnapshot(agent: AgentRow): Promise<EvalConfigSnapshot> {
    const links = await this.container.agentsRepo.linkedSkills(agent.id);
    const linked = links.map((l) => ({ skill: toSkillDto(l.skill), order: l.order, enabled: l.enabled }));
    const active = selectActiveSkills(linked);
    const blocks = renderSkillBlocks(linked); // index-aligned with `active`
    return {
      provider: agent.provider,
      model: agent.model,
      system_prompt: agent.systemPrompt,
      strategy: agent.strategy,
      skills: active.map((l, i) => {
        const heading = `### ${l.skill.name}\n`;
        const block = blocks[i] ?? '';
        return { name: l.skill.name, body: block.startsWith(heading) ? block.slice(heading.length) : block };
      }),
    };
  }
}

// ---- pure mappers -----------------------------------------------------------

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function alreadyEvalCase(caseId: string): AppError {
  return new AppError('already_eval_case', 'This finding is already an eval case', 409, { case_id: caseId });
}

function batchRunning(batch: { id: string; scope: 'set' | 'case' }): AppError {
  return new AppError('batch_running', 'An eval run is already in progress for this agent', 409, {
    batch_id: batch.id,
    scope: batch.scope,
  });
}

function iso(d: Date): string {
  return d.toISOString();
}

function passRate(b: EvalBatchRow): number {
  return b.tracesTotal ? (b.tracesPassed ?? 0) / b.tracesTotal : 0;
}

function trendPoint(b: EvalBatchRow): EvalTrendPoint {
  return {
    batch_id: b.id,
    agent_version: b.agentVersion,
    ran_at: iso(b.startedAt),
    recall: b.recall,
    precision: b.precision,
    citation_accuracy: b.citationAccuracy,
    pass_rate: passRate(b),
    cost_usd: b.costUsd,
  };
}

function batchToDto(row: EvalBatchRow, agentName: string, withSnapshot: boolean): EvalBatch {
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_name: agentName,
    scope: row.scope,
    agent_version: row.agentVersion,
    status: row.status,
    error: row.error,
    started_at: iso(row.startedAt),
    finished_at: row.finishedAt ? iso(row.finishedAt) : null,
    cases_total: row.casesTotal,
    cases_done: row.casesDone,
    traces_passed: row.tracesPassed,
    traces_total: row.tracesTotal,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    ...(withSnapshot ? { config_snapshot: row.configSnapshot as EvalConfigSnapshot } : {}),
  };
}

function runToDto(row: EvalRunRow & { caseName?: string | null }): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    batch_id: row.batchId,
    case_name: row.caseName ?? null,
    error: row.error,
    ran_at: iso(row.ranAt),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

function caseToDto(row: EvalCaseRow, last: EvalRunRow | null, full: boolean): EvalCaseDto {
  const actual = (last?.actualOutput ?? null) as { findings?: unknown[]; matched_finding_ids?: unknown[] } | null;
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: full ? (row.inputDiff ?? '') : '',
    input_files: row.inputFiles ?? null,
    input_meta: full ? (row.inputMeta ?? null) : null,
    expected_output: row.expectedOutput,
    notes: row.notes,
    source_finding_id: row.sourceFindingId,
    created_at: iso(row.createdAt),
    expectation: EvalExpectation.parse(row.expectedOutput),
    last_result: last
      ? {
          pass: last.pass,
          error: last.error,
          ran_at: iso(last.ranAt),
          actual_count: actual?.findings?.length ?? 0,
          matched_count: actual?.matched_finding_ids?.length ?? 0,
        }
      : null,
  };
}

function toJobCase(row: EvalCaseRow): EvalJob['cases'][number] {
  const meta = (row.inputMeta ?? {}) as { pr?: { number?: number; title?: string; body?: string | null } };
  return {
    id: row.id,
    name: row.name,
    inputDiff: row.inputDiff ?? '',
    pr: { number: meta.pr?.number ?? 0, title: meta.pr?.title ?? '', body: meta.pr?.body ?? null },
    expectation: EvalExpectation.parse(row.expectedOutput),
  };
}
