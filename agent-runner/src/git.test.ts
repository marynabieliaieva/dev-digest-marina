import { describe, it, expect } from 'vitest';
import { localPrDiff } from './git.js';
import { DiffTooLargeError, fetchPrDiff, type FetchLike } from './github.js';
import { RunnerError } from './errors.js';

const BASE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const ctx = { owner: 'acme', repo: 'widgets', prNumber: 12 };

function respond(status: number, body: string): FetchLike {
  return (async () => new Response(body, { status })) as unknown as FetchLike;
}

describe('fetchPrDiff', () => {
  it('throws DiffTooLargeError on GitHub 406 too_large', async () => {
    const body = JSON.stringify({
      message: 'Sorry, the diff exceeded the maximum number of files (300).',
      errors: [{ resource: 'PullRequest', field: 'diff', code: 'too_large' }],
    });
    await expect(fetchPrDiff(ctx, 't', respond(406, body))).rejects.toBeInstanceOf(DiffTooLargeError);
  });

  it('throws a plain RunnerError on any other failure', async () => {
    const err = await fetchPrDiff(ctx, 't', respond(500, 'boom')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect(err).not.toBeInstanceOf(DiffTooLargeError);
  });
});

describe('localPrDiff', () => {
  it('runs a three-dot git diff between the PR base and head', () => {
    const calls: string[][] = [];
    const diff = localPrDiff({ baseSha: BASE, headSha: HEAD }, (args) => {
      calls.push(args);
      return 'diff --git a/x b/x\n';
    });
    expect(diff).toBe('diff --git a/x b/x\n');
    expect(calls).toEqual([['diff', '--no-color', '--no-ext-diff', `${BASE}...${HEAD}`]]);
  });

  it('fails clearly when the event payload has no base or head SHA', () => {
    const neverGit = () => {
      throw new Error('git must not run');
    };
    expect(() => localPrDiff({ baseSha: null, headSha: HEAD }, neverGit)).toThrow(/base\/head SHA/);
    expect(() => localPrDiff({ baseSha: BASE, headSha: null }, neverGit)).toThrow(/base\/head SHA/);
  });

  it('wraps a git failure (e.g. a shallow checkout missing the base) in a RunnerError', () => {
    const failingGit = () => {
      throw new Error(`fatal: bad object ${BASE}`);
    };
    expect(() => localPrDiff({ baseSha: BASE, headSha: HEAD }, failingGit)).toThrow(RunnerError);
    expect(() => localPrDiff({ baseSha: BASE, headSha: HEAD }, failingGit)).toThrow(/fetch-depth/);
  });
});
