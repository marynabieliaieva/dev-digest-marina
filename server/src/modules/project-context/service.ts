import type {
  AgentContext,
  ContextDoc,
  ContextDocContent,
  ContextDocList,
  ContextPaths,
  ProjectContextEntry,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ProjectContextRepository, type RepoBasics } from './repository.js';
import {
  applyBudget,
  docType,
  estTokens,
  isSafeRelPath,
  matchesAny,
  mergeEffective,
  readDocConfined,
  walkDocs,
  type BudgetInput,
} from './helpers.js';
import { MAX_ATTACHED_PATHS } from './constants.js';

export interface ResolvedProjectContext {
  docs: { source: string; content: string }[];
  entries: ProjectContextEntry[];
  specsRead: string[];
  totalTokens: number;
}

export interface WorkspaceDoc {
  path: string;
  status: 'ok' | 'missing' | 'too_large' | 'unreadable';
  content: string | null;
  bytes: number;
}

const EMPTY_RESOLVED: ResolvedProjectContext = {
  docs: [],
  entries: [],
  specsRead: [],
  totalTokens: 0,
};

/**
 * Project-context service — lists/previews documents from a repo clone and
 * manages which paths an agent or skill attaches. Attachments never touch
 * agent/skill versions. All filesystem access goes through `helpers.ts`.
 */
export class ProjectContextService {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  // ---- repo documents ------------------------------------------------------

  async listDocs(workspaceId: string, repoId: string): Promise<ContextDocList> {
    const root = await this.cloneRootOrThrow(workspaceId, repoId);
    const globs = this.container.config.projectContextGlobs;

    let walked;
    try {
      walked = await walkDocs(root, globs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') throw notCloned();
      throw err;
    }

    const usage = await this.repo.listUsage(workspaceId);
    const byPath = new Map<string, Map<string, string>>();
    for (const u of usage) {
      let agents = byPath.get(u.path);
      if (!agents) byPath.set(u.path, (agents = new Map()));
      agents.set(u.agentId, u.agentName);
    }

    const docs: ContextDoc[] = walked.map((w) => {
      const agents = byPath.get(w.path);
      const used_by = agents ? [...agents].map(([id, name]) => ({ id, name })) : [];
      return {
        path: w.path,
        type: docType(w.path),
        size: w.size,
        est_tokens: estTokens(w.content),
        updated_at: w.mtime.toISOString(),
        used_by_agents: used_by.length,
        used_by,
      };
    });
    return { roots: globs, docs };
  }

  async getDoc(workspaceId: string, repoId: string, path: string): Promise<ContextDocContent> {
    const root = await this.cloneRootOrThrow(workspaceId, repoId);
    if (!isSafeRelPath(path) || !matchesAny(path, this.container.config.projectContextGlobs)) {
      throw new AppError('invalid_path', 'Invalid document path', 400);
    }
    const res = await readDocConfined(root, path);
    switch (res.status) {
      case 'ok':
        return { path, content: res.content, size: res.bytes, est_tokens: estTokens(res.content) };
      case 'missing':
        throw new NotFoundError('Document not found');
      case 'too_large':
        throw new AppError('too_large', 'Document is too large to preview', 413);
      default:
        throw new AppError('unreadable', 'Document could not be read', 422);
    }
  }

  // ---- attachments ---------------------------------------------------------

  async getAgentContext(workspaceId: string, agentId: string): Promise<AgentContext> {
    await this.assertAgent(workspaceId, agentId);
    const paths = await this.repo.getAgentPaths(agentId);
    const linked = (await this.container.agentsRepo.linkedSkills(agentId)).filter(
      (l) => l.enabled && l.skill.enabled,
    );
    const skillPaths = await this.repo.getSkillPathsMap(linked.map((l) => l.skill.id));

    const seen = new Set(paths);
    const inherited: AgentContext['inherited'] = [];
    for (const l of linked) {
      for (const path of skillPaths.get(l.skill.id) ?? []) {
        if (seen.has(path)) continue;
        seen.add(path);
        inherited.push({ path, skill_id: l.skill.id, skill_name: l.skill.name });
      }
    }
    return { paths, inherited };
  }

  async setAgentContext(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<AgentContext> {
    await this.assertAgent(workspaceId, agentId);
    assertValidPaths(paths);
    await this.repo.setAgentPaths(agentId, paths);
    return this.getAgentContext(workspaceId, agentId);
  }

  async getSkillContext(workspaceId: string, skillId: string): Promise<ContextPaths> {
    await this.assertSkill(workspaceId, skillId);
    return { paths: await this.repo.getSkillPaths(skillId) };
  }

  async setSkillContext(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextPaths> {
    await this.assertSkill(workspaceId, skillId);
    assertValidPaths(paths);
    await this.repo.setSkillPaths(skillId, paths);
    return { paths };
  }

  // ---- run-time resolution -------------------------------------------------

  /**
   * Resolve the agent's effective context (own paths, then enabled linked
   * skills') against a clone. Never throws for per-document problems: each
   * document ends up with a status instead.
   */
  async resolveForRun(
    workspaceId: string,
    agentId: string,
    clonePath: string | null,
  ): Promise<ResolvedProjectContext> {
    const agentPaths = await this.repo.getAgentPaths(agentId);
    const linked = (await this.container.agentsRepo.linkedSkills(agentId)).filter(
      (l) => l.enabled && l.skill.enabled,
    );
    const skillPaths = await this.repo.getSkillPathsMap(linked.map((l) => l.skill.id));
    const effective = mergeEffective(
      agentPaths,
      linked.map((l) => ({ name: l.skill.name, paths: skillPaths.get(l.skill.id) ?? [] })),
    );
    if (effective.length === 0) return EMPTY_RESOLVED;

    const globs = this.container.config.projectContextGlobs;
    type Item = { path: string; origin: 'agent' | 'skill'; skill_name?: string };
    const inputs: BudgetInput<Item>[] = [];
    for (const e of effective) {
      const base: Item = {
        path: e.path,
        origin: e.origin,
        ...(e.skill_name !== undefined ? { skill_name: e.skill_name } : {}),
      };
      if (clonePath === null) {
        inputs.push({ ...base, bytes: 0, content: null, readError: 'missing' });
      } else if (!isSafeRelPath(e.path) || !matchesAny(e.path, globs)) {
        inputs.push({ ...base, bytes: 0, content: null, readError: 'unreadable' });
      } else {
        const res = await readDocConfined(clonePath, e.path);
        if (res.status === 'ok') {
          inputs.push({ ...base, bytes: res.bytes, content: res.content });
        } else if (res.status === 'too_large') {
          inputs.push({ ...base, bytes: res.bytes, content: null, readError: 'too_large' });
        } else {
          inputs.push({ ...base, bytes: 0, content: null, readError: res.status });
        }
      }
    }

    const budgeted = applyBudget(inputs);
    const entries: ProjectContextEntry[] = budgeted.map((b) => ({
      path: b.path,
      origin: b.origin,
      ...(b.skill_name !== undefined ? { skill_name: b.skill_name } : {}),
      est_tokens: b.est_tokens,
      status: b.status,
    }));
    const included = budgeted.filter((b) => b.status === 'included');
    return {
      docs: included.map((b) => ({ source: b.path, content: b.content ?? '' })),
      entries,
      specsRead: included.map((b) => b.path),
      totalTokens: included.reduce((sum, b) => sum + b.est_tokens, 0),
    };
  }

  /**
   * Every document attached by any enabled agent (or its enabled linked
   * skills) in the workspace, read from the given repo's clone. First
   * occurrence of a path wins; agents ordered by creation. No token budget
   * here. Never throws for per-document problems or a missing clone.
   */
  async collectWorkspaceDocs(
    workspaceId: string,
    repoId: string,
  ): Promise<{ clone: boolean; docs: WorkspaceDoc[] }> {
    const basics = await this.repo.getRepoBasics(workspaceId, repoId);
    const clonePath = basics?.clonePath ?? null;
    if (clonePath === null) return { clone: false, docs: [] };

    const agentIds = await this.repo.listEnabledAgentIds(workspaceId);
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const agentId of agentIds) {
      const agentPaths = await this.repo.getAgentPaths(agentId);
      const linked = (await this.container.agentsRepo.linkedSkills(agentId)).filter(
        (l) => l.enabled && l.skill.enabled,
      );
      const skillPaths = await this.repo.getSkillPathsMap(linked.map((l) => l.skill.id));
      const effective = mergeEffective(
        agentPaths,
        linked.map((l) => ({ name: l.skill.name, paths: skillPaths.get(l.skill.id) ?? [] })),
      );
      for (const e of effective) {
        if (seen.has(e.path)) continue;
        seen.add(e.path);
        paths.push(e.path);
      }
    }

    const globs = this.container.config.projectContextGlobs;
    const docs: WorkspaceDoc[] = [];
    for (const path of paths) {
      if (!isSafeRelPath(path) || !matchesAny(path, globs)) {
        docs.push({ path, status: 'unreadable', content: null, bytes: 0 });
        continue;
      }
      const res = await readDocConfined(clonePath, path);
      if (res.status === 'ok') {
        docs.push({ path, status: 'ok', content: res.content, bytes: res.bytes });
      } else if (res.status === 'too_large') {
        docs.push({ path, status: 'too_large', content: null, bytes: res.bytes });
      } else {
        docs.push({ path, status: res.status, content: null, bytes: 0 });
      }
    }
    return { clone: true, docs };
  }

  // ---- internals -----------------------------------------------------------

  private async cloneRootOrThrow(workspaceId: string, repoId: string): Promise<string> {
    const basics: RepoBasics | undefined = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!basics) throw new NotFoundError('Repo not found');
    if (!basics.clonePath) throw notCloned();
    return basics.clonePath;
  }

  private async assertAgent(workspaceId: string, agentId: string): Promise<void> {
    if (!(await this.repo.agentExists(workspaceId, agentId))) {
      throw new NotFoundError('Agent not found');
    }
  }

  private async assertSkill(workspaceId: string, skillId: string): Promise<void> {
    if (!(await this.repo.skillExists(workspaceId, skillId))) {
      throw new NotFoundError('Skill not found');
    }
  }
}

function notCloned(): AppError {
  return new AppError('context_unavailable', 'Repository not cloned yet', 409);
}

/** Shape-only validation (existence is not checked: attachments are workspace-level). */
function assertValidPaths(paths: string[]): void {
  if (
    paths.length > MAX_ATTACHED_PATHS ||
    new Set(paths).size !== paths.length ||
    !paths.every(isSafeRelPath)
  ) {
    throw new AppError('invalid_path', 'Invalid or duplicate document path', 400);
  }
}
