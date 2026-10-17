import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions available in the starter: accept / dismiss. These decisions
 * are the dataset later lessons build on (eval cases from accept/dismiss, the
 * `learn → memory` action, etc.).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  // Re-query the derived eval_case_id after the write: a write path must not
  // blank it in the client's cache.
  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      const ids = await repo.evalCaseIdsForFindings([findingId]);
      return { finding: findingRowToDto(row!, ids.get(findingId) ?? null) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      const ids = await repo.evalCaseIdsForFindings([findingId]);
      return { finding: findingRowToDto(row!, ids.get(findingId) ?? null) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
