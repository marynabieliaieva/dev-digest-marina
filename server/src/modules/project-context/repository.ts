import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project-context data-access. Owns `agent_context_docs` and `skill_context_docs`
 * (paths only, never document text). Workspace-scoped: owner lookups filter by
 * `workspaceId`, so attachments can never be read or written across tenants.
 * Writes here deliberately bypass the agents/skills repositories so no version
 * is bumped and no snapshot row is written.
 */

export interface RepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

/** One (path, agent) usage edge: direct attachment or via an enabled skill link. */
export interface PathUsage {
  path: string;
  agentId: string;
  agentName: string;
}

export class ProjectContextRepository {
  constructor(private db: Db) {}

  async getRepoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async agentExists(workspaceId: string, agentId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return rows.length > 0;
  }

  async skillExists(workspaceId: string, skillId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return rows.length > 0;
  }

  // ---- agent attachments ---------------------------------------------------

  async getAgentPaths(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows.map((r) => r.path);
  }

  /** Replace the ordered list in one transaction (order = array index). */
  async setAgentPaths(agentId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (paths.length === 0) return;
      await tx
        .insert(t.agentContextDocs)
        .values(paths.map((path, order) => ({ agentId, path, order })));
    });
  }

  // ---- skill attachments ---------------------------------------------------

  async getSkillPaths(skillId: string): Promise<string[]> {
    const map = await this.getSkillPathsMap([skillId]);
    return map.get(skillId) ?? [];
  }

  /** Ordered attached paths per skill id; skills with none are absent. */
  async getSkillPathsMap(skillIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (skillIds.length === 0) return out;
    const rows = await this.db
      .select({ skillId: t.skillContextDocs.skillId, path: t.skillContextDocs.path })
      .from(t.skillContextDocs)
      .where(inArray(t.skillContextDocs.skillId, skillIds))
      .orderBy(asc(t.skillContextDocs.order));
    for (const r of rows) {
      const list = out.get(r.skillId);
      if (list) list.push(r.path);
      else out.set(r.skillId, [r.path]);
    }
    return out;
  }

  async setSkillPaths(skillId: string, paths: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (paths.length === 0) return;
      await tx
        .insert(t.skillContextDocs)
        .values(paths.map((path, order) => ({ skillId, path, order })));
    });
  }

  // ---- usage ---------------------------------------------------------------

  /**
   * Every (path, agent) edge in the workspace: agents attaching a path
   * directly, plus agents whose enabled link points at an enabled skill that
   * attaches it. Two queries total regardless of document count; callers dedupe.
   */
  async listUsage(workspaceId: string): Promise<PathUsage[]> {
    const direct = await this.db
      .select({
        path: t.agentContextDocs.path,
        agentId: t.agents.id,
        agentName: t.agents.name,
      })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));

    const viaSkill = await this.db
      .select({
        path: t.skillContextDocs.path,
        agentId: t.agents.id,
        agentName: t.agents.name,
      })
      .from(t.skillContextDocs)
      .innerJoin(t.skills, eq(t.skills.id, t.skillContextDocs.skillId))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.agents.workspaceId, workspaceId),
          eq(t.skills.enabled, true),
          eq(t.agentSkills.enabled, true),
        ),
      );

    return [...direct, ...viaSkill];
  }
}
