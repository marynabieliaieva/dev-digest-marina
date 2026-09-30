import { SmartDiffResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { SmartDiffRepository } from './repository.js';
import { buildSmartDiff, selectLatestReviews } from './helpers.js';

/**
 * Smart Diff service — groups a PR's persisted files by role and attaches the
 * lines of the latest review findings. Deterministic: reads only the DB.
 */
export class SmartDiffService {
  constructor(private repo: SmartDiffRepository) {}

  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiffResponse> {
    if (!(await this.repo.pullExists(workspaceId, prId))) {
      throw new NotFoundError('Pull request not found');
    }
    const [files, reviews] = await Promise.all([this.repo.listFiles(prId), this.repo.listReviews(prId)]);
    const findings = selectLatestReviews(reviews).flatMap((r) => r.findings);
    return SmartDiffResponse.parse(buildSmartDiff(files, findings));
  }
}
