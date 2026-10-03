import type { PrDetail, PrMeta, GitHubClient } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { PullsRepository, type PullRow, type RepoRow, type FindingBuckets } from './repository.js';
import { deriveReviewStatus } from './status.js';
import { RepoService } from '../repos/service.js';

/**
 * F1 — pulls service. PR import/sync from GitHub, detail refresh, and the PR
 * list read-model. No HTTP and no raw SQL here — persistence goes through
 * PullsRepository; GitHub through the container's GitHubClient port.
 */

/** Minimal logger surface (Fastify's req/app logger satisfies it). */
export interface WarnLogger {
  warn(obj: unknown, msg?: string): void;
}

const NOOP_LOG: WarnLogger = { warn: () => undefined };

/**
 * Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs land
 * zeroed. Backfill is capped per request (each is a detail fetch).
 */
const BACKFILL_LIMIT = 10;

export class PullsService {
  private pulls: PullsRepository;

  constructor(private container: Container) {
    this.pulls = new PullsRepository(container.db);
  }

  /** Workspace-scoped repo lookup; throws 404. */
  async getRepoOrThrow(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.pulls.findRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /** Workspace-scoped PR + its repo; throws 404. */
  async getPrAndRepo(workspaceId: string, prId: string): Promise<{ pr: PullRow; repo: RepoRow }> {
    const pr = await this.pulls.findById(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.pulls.findRepoOfPull(pr);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  /** Persisted lookup of a PR by number within a repo. */
  findByNumber(workspaceId: string, repoId: string, number: number): Promise<PullRow | undefined> {
    return this.pulls.findByNumber(workspaceId, repoId, number);
  }

  /** Upsert every PR from GitHub's list endpoint for the repo. Throws on GitHub failure. */
  async syncFromGitHub(
    gh: GitHubClient,
    workspaceId: string,
    repo: Pick<RepoRow, 'id' | 'owner' | 'name'>,
  ): Promise<void> {
    const list = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    for (const pr of list) {
      await this.pulls.upsertFromList(workspaceId, repo.id, pr);
    }
  }

  /**
   * Fetch PR detail from GitHub and replace persisted files/commits/body/stats.
   * Throws on GitHub failure (callers decide whether to fall back).
   */
  async refreshFiles(
    gh: GitHubClient,
    repo: Pick<RepoRow, 'owner' | 'name'>,
    pr: Pick<PullRow, 'id' | 'number'>,
  ): Promise<PrDetail> {
    const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);
    await this.pulls.replaceDetail(pr.id, detail);
    return detail;
  }

  /**
   * Resolve a PR by number: persisted row if present, else sync from GitHub.
   * Files are fetched when the PR was just synced or has none persisted, so a
   * review has a diff to work on. Returns null when the PR cannot be found
   * (including no GitHub token / offline for a PR that isn't persisted).
   */
  async findOrSync(
    workspaceId: string,
    repo: Pick<RepoRow, 'id' | 'owner' | 'name'>,
    number: number,
    log: WarnLogger = NOOP_LOG,
  ): Promise<PullRow | null> {
    let pr = await this.pulls.findByNumber(workspaceId, repo.id, number);
    let synced = false;

    let gh: GitHubClient | null = null;
    try {
      gh = await this.container.github();
    } catch (err) {
      log.warn({ err }, 'GitHub client unavailable; cannot sync PR');
    }

    if (!pr) {
      if (!gh) return null;
      try {
        await this.syncFromGitHub(gh, workspaceId, repo);
      } catch (err) {
        log.warn({ err }, 'GitHub PR sync failed');
        return null;
      }
      pr = await this.pulls.findByNumber(workspaceId, repo.id, number);
      if (!pr) return null;
      synced = true;
    }

    if (gh && (synced || (await this.pulls.listFiles(pr.id)).length === 0)) {
      try {
        await this.refreshFiles(gh, repo, pr);
        pr = (await this.pulls.findByNumber(workspaceId, repo.id, number)) ?? pr;
      } catch (err) {
        log.warn({ err }, 'GitHub PR file fetch skipped');
      }
    }
    return pr;
  }

  /** Resolve `owner/name | name` + PR number to a persisted PR (404 with a next step). */
  async resolveByRef(
    workspaceId: string,
    repoRef: string,
    prNumber: number,
    log: WarnLogger = NOOP_LOG,
  ): Promise<{ pull: PullRow; repoFullName: string }> {
    const resolved = await new RepoService(this.container).resolve(workspaceId, repoRef);
    const repo = await this.pulls.findRepo(workspaceId, resolved.id);
    if (!repo) throw new NotFoundError('Repo not found');
    const pull = await this.findOrSync(workspaceId, repo, prNumber, log);
    if (!pull) {
      throw new NotFoundError(
        `PR #${prNumber} not found in ${resolved.full_name}. Check the number, or configure a GitHub token so devdigest can sync it.`,
      );
    }
    return { pull, repoFullName: resolved.full_name };
  }

  /** GET /pulls/:id — refreshed from GitHub when possible, else persisted. */
  async getDetail(workspaceId: string, prId: string, log: WarnLogger = NOOP_LOG): Promise<PrDetail> {
    const { pr, repo } = await this.getPrAndRepo(workspaceId, prId);

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body so PR detail works offline.
    try {
      const gh = await this.container.github();
      const detail = await this.refreshFiles(gh, repo, pr);
      return { ...detail, id: pr.id };
    } catch (err) {
      log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await this.pulls.listFiles(pr.id);
      const commits = await this.pulls.listCommits(pr.id);
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  }

  /** GET /repos/:id/pulls — list read-model (sync + backfill + aggregates). */
  async listForRepo(
    workspaceId: string,
    repoId: string,
    log: WarnLogger = NOOP_LOG,
  ): Promise<PrMeta[]> {
    const repo = await this.getRepoOrThrow(workspaceId, repoId);

    let gh: GitHubClient | null = null;
    try {
      gh = await this.container.github();
    } catch (err) {
      log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        await this.syncFromGitHub(gh, workspaceId, repo);
      } catch (err) {
        log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await this.pulls.listByRepo(repo.id);

    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await this.pulls.updateStats(r.id, {
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          });
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // Latest-review SCORE per PR for the list's score ring (computed on read).
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = await this.pulls.latestReviewsByPr(prIds);

    // Latest-review FINDINGS per PR, bucketed by severity. A PR with a latest
    // review always gets a bucket (zeros if clean); a PR with no review has no
    // entry (→ null) — "not reviewed" vs. "reviewed, clean" differ.
    const findingsByPr = new Map<string, FindingBuckets>();
    const reviewIdToPrId = new Map<string, string>();
    for (const [prId, rv] of latestReviewByPr) {
      findingsByPr.set(prId, { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
      reviewIdToPrId.set(rv.reviewId, prId);
    }
    for (const fr of await this.pulls.findingSeverities([...reviewIdToPrId.keys()])) {
      const prId = reviewIdToPrId.get(fr.reviewId);
      if (!prId) continue;
      if (fr.severity !== 'CRITICAL' && fr.severity !== 'WARNING' && fr.severity !== 'SUGGESTION')
        continue;
      findingsByPr.get(prId)![fr.severity] += 1;
    }

    // Summed LLM cost per PR; all-null (or no runs) → null, never "$0".
    const costByPr = new Map<string, number | null>();
    for (const row of await this.pulls.runCosts(prIds)) {
      if (!row.prId) continue;
      if (row.costUsd == null) continue;
      costByPr.set(row.prId, (costByPr.get(row.prId) ?? 0) + row.costUsd);
    }

    const now = Date.now();
    return rows.map((r) => {
      const review = latestReviewByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: review ? review.score : null,
        cost_usd: costByPr.get(r.id) ?? null,
        findings: findingsByPr.get(r.id) ?? null,
      };
    });
  }
}
