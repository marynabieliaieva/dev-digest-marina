import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { CiResultArtifact, PrDetail, WorkflowRunSummary } from '@devdigest/shared';
import { MAX_ARTIFACT_BYTES, crossCheckArtifact, readSingleZipEntry, withVerifiedPullRequest } from './ingest.js';

const SHA = 'a'.repeat(40);

/** Build a minimal PKZIP archive from `[name, bytes]` entries (deflate). */
function zip(entries: [string, Buffer][], opts: { lieAboutSize?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(opts.lieAboutSize ?? data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

describe('readSingleZipEntry (AC-59)', () => {
  it('reads the single devdigest-result.json entry', () => {
    const r = readSingleZipEntry(zip([['devdigest-result.json', Buffer.from('{"a":1}')]]), 'devdigest-result.json');
    expect(r).toEqual({ ok: true, json: '{"a":1}' });
  });

  it('rejects an extra file', () => {
    const r = readSingleZipEntry(
      zip([
        ['devdigest-result.json', Buffer.from('{}')],
        ['notes.txt', Buffer.from('x')],
      ]),
      'devdigest-result.json',
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a differently named or nested entry', () => {
    expect(readSingleZipEntry(zip([['other.json', Buffer.from('{}')]]), 'devdigest-result.json').ok).toBe(false);
    expect(readSingleZipEntry(zip([['dir/devdigest-result.json', Buffer.from('{}')]]), 'devdigest-result.json').ok).toBe(false);
  });

  it('rejects an entry that inflates beyond the cap (honest header)', () => {
    const big = Buffer.alloc(MAX_ARTIFACT_BYTES + 1, 0x20);
    const r = readSingleZipEntry(zip([['devdigest-result.json', big]]), 'devdigest-result.json');
    expect(r).toMatchObject({ ok: false, reason: 'artifact content exceeds 1 MB' });
  });

  it('rejects a zip bomb whose header lies about the inflated size', () => {
    const big = Buffer.alloc(MAX_ARTIFACT_BYTES * 4, 0x20);
    const r = readSingleZipEntry(zip([['devdigest-result.json', big]], { lieAboutSize: 10 }), 'devdigest-result.json');
    expect(r.ok).toBe(false);
  });

  it('rejects garbage', () => {
    expect(readSingleZipEntry(Buffer.from('not a zip at all, definitely'), 'devdigest-result.json').ok).toBe(false);
  });
});

describe('crossCheckArtifact (AC-60)', () => {
  const run = {
    id: 1,
    headSha: SHA,
    repositoryId: 42,
    repositoryFullName: 'acme/demo',
    pullRequestNumbers: [7],
  } as WorkflowRunSummary;
  const good = {
    findings_count: 0,
    cost_usd: null,
    agent: 'A',
    agent_slug: 'a',
    repository: 'acme/demo',
    repository_id: 42,
    head_sha: SHA,
    pr_number: 7,
  } as CiResultArtifact;

  it('accepts a matching artifact (repo compared case-insensitively)', () => {
    expect(crossCheckArtifact(good, run, 'acme/demo')).toBeNull();
    expect(crossCheckArtifact({ ...good, repository: 'ACME/Demo' }, run, 'acme/demo')).toBeNull();
  });

  it.each([
    ['repository', { repository: 'evil/other' }],
    ['repository_id', { repository_id: 43 }],
    ['head_sha', { head_sha: 'b'.repeat(40) }],
    ['pr_number', { pr_number: 8 }],
  ])('rejects a mismatched %s', (field, patch) => {
    expect(crossCheckArtifact({ ...good, ...patch } as CiResultArtifact, run, 'acme/demo')).toContain(field);
  });

  it('rejects an artifact for a different installation repo', () => {
    expect(crossCheckArtifact(good, run, 'acme/other')).toContain('installation');
  });

  it('fails closed when identity fields are missing', () => {
    for (const k of ['repository', 'repository_id', 'head_sha', 'pr_number'] as const) {
      expect(crossCheckArtifact({ ...good, [k]: null } as CiResultArtifact, run, 'acme/demo')).not.toBeNull();
    }
  });

  it('fails closed when GitHub metadata is missing', () => {
    expect(crossCheckArtifact(good, { ...run, repositoryId: undefined } as WorkflowRunSummary, 'acme/demo')).not.toBeNull();
    expect(crossCheckArtifact(good, { ...run, pullRequestNumbers: undefined } as WorkflowRunSummary, 'acme/demo')).not.toBeNull();
  });
});

describe('withVerifiedPullRequest (merged PR → empty pull_requests)', () => {
  const repoRef = { owner: 'acme', name: 'demo' };
  const OLDER_SHA = 'c'.repeat(40);
  // What GitHub returns for a run once its PR is merged: no pull_requests.
  const mergedRun = {
    id: 1,
    headSha: SHA,
    repositoryId: 42,
    repositoryFullName: 'acme/demo',
    pullRequestNumbers: [],
  } as unknown as WorkflowRunSummary;
  const artifact = {
    findings_count: 0,
    cost_usd: null,
    agent: 'A',
    agent_slug: 'a',
    repository: 'acme/demo',
    repository_id: 42,
    head_sha: SHA,
    pr_number: 7,
  } as CiResultArtifact;

  function githubWithPr(pr: Partial<PrDetail> | Error) {
    const getPullRequest = vi.fn(async () => {
      if (pr instanceof Error) throw pr;
      return { head_sha: SHA, commits: [], ...pr } as PrDetail;
    });
    return { getPullRequest };
  }

  it('without the fallback the merged-PR run is rejected on pr_number', () => {
    expect(crossCheckArtifact(artifact, mergedRun, 'acme/demo')).toContain('pr_number');
  });

  it('accepts the run when the claimed PR head SHA matches the run head SHA', async () => {
    const github = githubWithPr({ head_sha: SHA.toUpperCase() });
    const verified = await withVerifiedPullRequest(github, repoRef, mergedRun, 7);
    expect(github.getPullRequest).toHaveBeenCalledWith(repoRef, 7);
    expect(verified.pullRequestNumbers).toEqual([7]);
    expect(crossCheckArtifact(artifact, verified, 'acme/demo')).toBeNull();
  });

  it('accepts a run for an earlier push to the same PR (SHA among its commits)', async () => {
    const github = githubWithPr({ head_sha: 'd'.repeat(40), commits: [{ sha: SHA } as PrDetail['commits'][number]] });
    const verified = await withVerifiedPullRequest(github, repoRef, mergedRun, 7);
    expect(crossCheckArtifact(artifact, verified, 'acme/demo')).toBeNull();
  });

  it('keeps rejecting when the claimed PR does not contain the run SHA', async () => {
    const github = githubWithPr({ head_sha: OLDER_SHA, commits: [{ sha: OLDER_SHA } as PrDetail['commits'][number]] });
    const verified = await withVerifiedPullRequest(github, repoRef, mergedRun, 7);
    expect(verified).toBe(mergedRun);
    expect(crossCheckArtifact(artifact, verified, 'acme/demo')).toContain('pr_number');
  });

  it('fails closed when the PR lookup throws', async () => {
    const github = githubWithPr(new Error('404'));
    const verified = await withVerifiedPullRequest(github, repoRef, mergedRun, 7);
    expect(crossCheckArtifact(artifact, verified, 'acme/demo')).toContain('pr_number');
  });

  it('does not call GitHub when the run already lists PRs or no PR is claimed', async () => {
    const github = githubWithPr({});
    const openRun = { ...mergedRun, pullRequestNumbers: [7] } as WorkflowRunSummary;
    expect(await withVerifiedPullRequest(github, repoRef, openRun, 7)).toBe(openRun);
    expect(await withVerifiedPullRequest(github, repoRef, mergedRun, null)).toBe(mergedRun);
    expect(github.getPullRequest).not.toHaveBeenCalled();
  });

  it('looks each PR up once per refresh via the shared cache', async () => {
    const github = githubWithPr({});
    const cache = new Map();
    await withVerifiedPullRequest(github, repoRef, mergedRun, 7, cache);
    await withVerifiedPullRequest(github, repoRef, { ...mergedRun, id: 2 } as WorkflowRunSummary, 7, cache);
    expect(github.getPullRequest).toHaveBeenCalledTimes(1);
  });
});
