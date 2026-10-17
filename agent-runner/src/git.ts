import { execFileSync } from 'node:child_process';
import { RunnerError } from './errors.js';
import type { PrContext } from './context.js';

/**
 * Local `git diff` of the PR from the job's checkout — the fallback when
 * GitHub's diff media type refuses a large PR (406 `too_large`). The generated
 * workflow checks out the PR head with `fetch-depth: 0`, so both the base and
 * head commits are present locally. Three-dot (`base...head`) diffs against
 * the merge base, which is what GitHub's own PR diff shows.
 *
 * Both SHAs come from `resolvePrContext`, which only accepts 40-char hex — so
 * neither can be read by git as an option. `execFile` (no shell) is injectable
 * so tests never spawn git.
 */

export type ExecGit = (args: string[]) => string;

/** Large PRs produce large diffs — well past execFileSync's 1 MB default. */
const MAX_DIFF_BYTES = 256 * 1024 * 1024;

const defaultExecGit: ExecGit = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_DIFF_BYTES });

export function localPrDiff(
  ctx: Pick<PrContext, 'baseSha' | 'headSha'>,
  execGit: ExecGit = defaultExecGit,
): string {
  if (!ctx.baseSha || !ctx.headSha) {
    throw new RunnerError(
      'Cannot build a local git diff: the pull_request event payload has no base/head SHA',
    );
  }
  try {
    return execGit(['diff', '--no-color', '--no-ext-diff', `${ctx.baseSha}...${ctx.headSha}`]);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new RunnerError(
      `Local git diff ${ctx.baseSha}...${ctx.headSha} failed (is the checkout fetch-depth: 0?): ${detail}`,
    );
  }
}
