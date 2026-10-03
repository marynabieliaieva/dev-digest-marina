import { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import type { RepoIntel } from '../repo-intel/types.js';
import { BlastRepository } from './repository.js';
import { countCallers, resolveDegradedReason, toBlastRadius } from './helpers.js';
import { BLAST_LOG_MSG } from './constants.js';

/** Minimal logger surface (Fastify's req/app logger satisfies it). */
export interface BlastLogger {
  info(obj: object, msg?: string): void;
}

const NOOP_LOG: BlastLogger = { info: () => undefined };

/**
 * Blast Radius service — serves a PR's blast radius from the repo-intel index.
 * No LLM, no re-parsing: one `getBlastRadius` + one `getIndexState` call.
 */
export class BlastService {
  constructor(
    private repo: BlastRepository,
    private repoIntel: RepoIntel,
    private flagEnabled: () => boolean,
    private log: BlastLogger = NOOP_LOG,
  ) {}

  static fromContainer(container: Container, log?: BlastLogger): BlastService {
    return new BlastService(
      new BlastRepository(container.db),
      container.repoIntel,
      () => container.config.repoIntelEnabled,
      log,
    );
  }

  async getBlast(workspaceId: string, prId: string, log?: BlastLogger): Promise<BlastRadiusResponse> {
    const pull = await this.repo.findPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const paths = await this.repo.listChangedPaths(pull.id);
    const [result, state] = await Promise.all([
      this.repoIntel.getBlastRadius(pull.repoId, paths),
      this.repoIntel.getIndexState(pull.repoId),
    ]);

    const degraded = result.degraded === true;
    const blast = toBlastRadius(result);
    const response = BlastRadiusResponse.parse({
      pr_id: pull.id,
      indexed_sha: !degraded && state.lastIndexedSha ? state.lastIndexedSha : null,
      index_status: state.status,
      degraded,
      reason: resolveDegradedReason(result, state, this.flagEnabled()),
      blast,
    });

    (log ?? this.log).info(
      { index_status: state.status, changed_files: paths.length, callers: countCallers(blast) },
      BLAST_LOG_MSG,
    );
    return response;
  }
}
