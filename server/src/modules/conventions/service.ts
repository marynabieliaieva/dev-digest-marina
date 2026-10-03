import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionsPage,
  ConventionStatus,
  Provider,
  Skill,
} from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import { renderPrompt } from '../../platform/prompts.js';
import { getFeatureModelOverride } from '../settings/feature-models.js';
import { SkillsRepository } from '../skills/repository.js';
import { SkillsService } from '../skills/service.js';
import { AgentsService } from '../agents/service.js';
import { ConventionsRepository, type InsertConvention } from './repository.js';
import {
  buildPackageJsonDigest,
  groundConventions,
  mergeToSkillBody,
  numberLines,
  pickConfigFiles,
  readSourceSamples,
  toCandidateDto,
  toExtractionDto,
  type RawConventionCandidate,
} from './helpers.js';
import {
  CATEGORIES,
  DEFAULT_MODEL,
  EXTRACT_JOB_KIND,
  MAX_FILE_LINES,
  MAX_SAMPLE_TOKENS,
  MAX_SELECTED_FILES,
  SAMPLE_FILE_COUNT,
} from './constants.js';

/**
 * Conventions service — the extraction pipeline plus the accept/reject/merge
 * flow that turns accepted candidates into one skill.
 *
 * Pipeline (see `runExtraction`): sample (code only) → Call 1 selects which
 * sampled files to read in full → Call 2 extracts candidates from those
 * bodies → `groundConventions` (pure code) drops anything that can't be
 * proven against the actual sampled content → persist. Never throws past
 * `runExtraction`'s own try/catch — the job handler always writes a terminal
 * `done`/`failed` row (see root CLAUDE.md risks).
 */

const FileSelection = z.object({
  files: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .max(MAX_SELECTED_FILES),
});

const ExtractionOutput = z.object({
  conventions: z.array(
    z.object({
      category: z.string(),
      rule: z.string(),
      evidence: z.object({
        path: z.string(),
        line: z.number().int(),
        snippet: z.string(),
      }),
      confidence: z.number(),
    }),
  ),
});

interface ExtractPayload {
  extractionId: string;
  repoId: string;
  workspaceId: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  type: Skill['type'];
  body: string;
  token_count: number;
}

export interface CreateSkillFromConventionsInput {
  name: string;
  description: string;
  type: Skill['type'];
  body: string;
  enabled: boolean;
  candidateIds: string[];
  agentId?: string;
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  registerJobHandler(): void {
    this.container.jobs.register(EXTRACT_JOB_KIND, async (payload) => {
      const p = payload as ExtractPayload;
      await this.runExtraction(p.workspaceId, p.repoId, p.extractionId);
    });
  }

  /** Enqueue a scan. Returns immediately with the new extraction's id. */
  async extract(workspaceId: string, repoId: string): Promise<{ extractionId: string }> {
    const model = (await getFeatureModelOverride(this.container, workspaceId, 'conventions')) ?? DEFAULT_MODEL;
    const extraction = await this.repo.createExtraction(workspaceId, repoId, model);
    try {
      await this.container.jobs.enqueue(workspaceId, EXTRACT_JOB_KIND, {
        extractionId: extraction.id,
        repoId,
        workspaceId,
      } satisfies ExtractPayload);
    } catch {
      // No handler registered (shouldn't happen outside a misconfigured test
      // container) — still leave a terminal row rather than "running" forever.
      await this.repo.finishExtraction(extraction.id, {
        status: 'failed',
        sampledFiles: 0,
        candidatesRaw: 0,
        candidatesKept: 0,
        error: 'no_job_handler',
      });
    }
    return { extractionId: extraction.id };
  }

  /** Latest extraction + its candidates for a repo. Degrades to a null header
   *  when no scan has ever run — never a 404, the page is just empty. */
  async get(workspaceId: string, repoId: string): Promise<ConventionsPage> {
    const extraction = await this.repo.getLatestExtraction(workspaceId, repoId);
    if (!extraction) return { extraction: null, candidates: [] };
    const rows = await this.repo.listCandidates(workspaceId, extraction.id);
    return { extraction: toExtractionDto(extraction), candidates: rows.map(toCandidateDto) };
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory },
  ): Promise<ConventionCandidate | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;
    const edited =
      existing.edited || (patch.rule !== undefined && patch.rule !== existing.rule) ||
      (patch.category !== undefined && patch.category !== existing.category);
    const row = await this.repo.update(workspaceId, id, { ...patch, edited });
    return row ? toCandidateDto(row) : undefined;
  }

  /** Draft a merged skill body from the given accepted candidates. Persists NOTHING. */
  async skillPreview(
    workspaceId: string,
    repoId: string,
    candidateIds: string[],
  ): Promise<SkillPreview> {
    const rows = await this.repo.getByIds(workspaceId, candidateIds);
    const dtos = rows.map(toCandidateDto);
    const repoBasics = await this.repo.getRepoBasics(workspaceId, repoId);
    const repoName = repoBasics?.fullName ?? repoBasics?.name ?? 'repo';
    const body = mergeToSkillBody(dtos);
    return {
      name: `${repoBasics?.name ?? 'repo'}-conventions`,
      description: `${dtos.length} house convention${dtos.length === 1 ? '' : 's'} extracted from ${repoName}`,
      type: 'convention',
      body,
      token_count: this.container.tokenizer.count(body),
    };
  }

  /**
   * Persist the merged skill (via SkillsService, so it goes through the same
   * body-budget guard as any other skill), stamp `conventions.skill_id` on the
   * accepted candidates that fed it, and optionally link it to an agent.
   */
  async createSkillFromConventions(
    workspaceId: string,
    input: CreateSkillFromConventionsInput,
  ): Promise<Skill> {
    const skillsService = new SkillsService(this.container);
    const skill = await skillsService.create(workspaceId, {
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      source: 'extracted',
      enabled: input.enabled,
    });
    await this.repo.stampSkillId(workspaceId, input.candidateIds, skill.id);
    if (input.agentId) {
      const agentsService = new AgentsService(this.container);
      await agentsService.linkSkill(workspaceId, input.agentId, skill.id);
    }
    return skill;
  }

  // ---------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------

  private async runExtraction(workspaceId: string, repoId: string, extractionId: string): Promise<void> {
    try {
      const extraction = await this.repo.getExtractionById(extractionId);
      const repoBasics = await this.repo.getRepoBasics(workspaceId, repoId);
      if (!extraction || !repoBasics || !repoBasics.clonePath) {
        await this.repo.finishExtraction(extractionId, {
          status: 'done',
          sampledFiles: 0,
          candidatesRaw: 0,
          candidatesKept: 0,
        });
        return;
      }
      const clonePath = repoBasics.clonePath;

      const configPick = await pickConfigFiles(clonePath, MAX_FILE_LINES);
      const sourcePaths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
      const sourceSamples = await readSourceSamples(
        clonePath,
        sourcePaths,
        this.container.tokenizer,
        MAX_FILE_LINES,
        MAX_SAMPLE_TOKENS,
      );

      const totalSampled = configPick.files.length + sourceSamples.length;
      if (totalSampled === 0) {
        await this.repo.finishExtraction(extractionId, {
          status: 'done',
          sampledFiles: 0,
          candidatesRaw: 0,
          candidatesKept: 0,
        });
        return;
      }

      const provider = (extraction.provider ?? DEFAULT_MODEL.provider) as Provider;
      const model = extraction.model ?? DEFAULT_MODEL.model;
      const llm = await this.container.llm(provider);

      const selectedPaths = await this.selectFiles(
        llm,
        model,
        sourceSamples.map((s) => s.path),
        repoId,
      );
      const selectedSet = new Set(selectedPaths.length > 0 ? selectedPaths : sourceSamples.map((s) => s.path));
      const selectedSamples = sourceSamples
        .filter((s) => selectedSet.has(s.path))
        .slice(0, MAX_SELECTED_FILES);

      const citable = new Map<string, string[]>();
      for (const f of configPick.files) citable.set(f.path, f.lines);
      for (const s of selectedSamples) citable.set(s.path, s.lines);

      const raw = await this.extractCandidates(
        llm,
        model,
        configPick.files,
        configPick.packageJsonDigest,
        selectedSamples,
      );

      const existingSkills = await new SkillsRepository(this.container.db).list(workspaceId);
      const existingBodies = existingSkills.filter((s) => s.enabled).map((s) => s.body);

      const { kept, raw: rawCount, droppedCount } = groundConventions(raw, citable, existingBodies);
      void droppedCount; // surfaced via candidatesRaw - candidatesKept in the DTO

      const rowsToInsert: InsertConvention[] = kept.map((c) => ({
        workspaceId,
        repoId,
        extractionId,
        category: c.category,
        rule: c.rule,
        evidencePath: c.evidencePath,
        evidenceLine: c.evidenceLine,
        evidenceSnippet: c.evidenceSnippet,
        confidence: c.confidence,
      }));
      await this.repo.insertCandidates(rowsToInsert);

      await this.repo.finishExtraction(extractionId, {
        status: 'done',
        sampledFiles: citable.size,
        candidatesRaw: rawCount,
        candidatesKept: kept.length,
      });
    } catch (err) {
      await this.repo.finishExtraction(extractionId, {
        status: 'failed',
        sampledFiles: 0,
        candidatesRaw: 0,
        candidatesKept: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async selectFiles(
    llm: Awaited<ReturnType<Container['llm']>>,
    model: string,
    candidatePaths: string[],
    repoId: string,
  ): Promise<string[]> {
    if (candidatePaths.length === 0) return [];
    const repoMap = await this.container.repoIntel.getRepoMap(repoId);
    const system = await renderPrompt('conventions.select.md', {
      max_files: String(MAX_SELECTED_FILES),
    });
    const data = wrapUntrusted(
      'repo-samples',
      [
        'CANDIDATE PATH LIST:',
        candidatePaths.join('\n'),
        '',
        'REPO MAP:',
        repoMap.text || '(unavailable)',
      ].join('\n'),
    );
    const res = await llm.completeStructured({
      model,
      schema: FileSelection,
      schemaName: 'ConventionFileSelection',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: data },
      ],
    });
    const picked = res.data.files.map((f) => f.path).filter((p) => candidatePaths.includes(p));
    return picked.slice(0, MAX_SELECTED_FILES);
  }

  private async extractCandidates(
    llm: Awaited<ReturnType<Container['llm']>>,
    model: string,
    configFiles: { path: string; lines: string[] }[],
    packageJsonDigest: string | null,
    selectedSamples: { path: string; lines: string[] }[],
  ): Promise<RawConventionCandidate[]> {
    if (configFiles.length === 0 && selectedSamples.length === 0) return [];

    const system = await renderPrompt('conventions.extract.md', {
      categories: CATEGORIES.join(', '),
    });

    const parts: string[] = [];
    if (configFiles.length > 0) {
      parts.push('CONFIG FILES (line-numbered):');
      for (const f of configFiles) {
        parts.push(`--- ${f.path} ---`);
        parts.push(numberLines(f.lines.join('\n'), f.lines.length));
      }
    }
    if (packageJsonDigest) {
      parts.push('', 'package.json (scripts + dependency digest — not a citable path):', packageJsonDigest);
    }
    if (selectedSamples.length > 0) {
      parts.push('', 'SOURCE FILES (line-numbered):');
      for (const f of selectedSamples) {
        parts.push(`--- ${f.path} ---`);
        parts.push(numberLines(f.lines.join('\n'), f.lines.length));
      }
    }

    const res = await llm.completeStructured({
      model,
      schema: ExtractionOutput,
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: wrapUntrusted('repo-files', parts.join('\n')) },
      ],
    });
    return res.data.conventions;
  }
}
