import { inflateRawSync } from 'node:zlib';
import type { CiRunStatus, Finding, WorkflowRunSummary } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { countBlockers, gateTriggered } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { CI_RESULT_ARTIFACT_NAME, CI_RESULT_FILE_NAME, GHA_WORKFLOW_PATH } from './constants.js';
import { parseRepoSlug } from './helpers.js';
import { slugFromName } from './slug.js';

/**
 * Pull-based CI ingest (T6, AC-27..AC-32). Polls each tracked GHA installation
 * for finished workflow runs, downloads the `devdigest-result.json` artifact,
 * and persists a validated result as an `agent_runs` row — through
 * `container.reviewRepo.createCiAgentRun` (the ONLY writer; see the doc
 * comment on `ReviewRepository`). This module never touches `agent_runs`
 * directly and is never imported by `routes.ts` (only `CiService` calls in).
 *
 * There is deliberately no inbound push endpoint (AC-27): the target repo's
 * CI has no way to reach this server, so results only ever arrive by the
 * studio polling GitHub's Actions API and pulling the artifact itself.
 *
 * The artifact is UNTRUSTED runner output. It is accepted only when it is a
 * small single-file zip, parses against the STRICT `CiResultArtifact`, and its
 * self-reported identity (repository, repository id, head SHA, PR number, agent
 * slug) agrees with what GitHub itself reports for that workflow run.
 */

/** Hard cap on the artifact zip and on the inflated `devdigest-result.json` (AC-59). */
export const MAX_ARTIFACT_BYTES = 1024 * 1024;

const GHA_WORKFLOW_FILE_NAME = GHA_WORKFLOW_PATH.split('/').pop() as string;

export interface RefreshResult {
  degraded: boolean;
  message?: string | null;
  /** Artifacts that were refused, with the reason (never the artifact content — AC-68). */
  rejected: { github_run_id: number; reason: string }[];
}

/**
 * Refresh every GHA installation across the workspace's agents. Each
 * installation is processed independently: a failure listing its workflow
 * runs (GitHub API unavailable / rate-limited) marks the overall refresh
 * `degraded` and writes NOTHING for that installation (AC-32) — it does not
 * abort the rest of the workspace. A failure downloading/parsing ONE run's
 * artifact (missing, expired, invalid JSON) only skips that run (AC-31); a
 * REFUSED artifact (oversized, wrong shape, identity mismatch) is skipped and
 * reported in `rejected`.
 */
export async function refreshCiRuns(container: Container, workspaceId: string): Promise<RefreshResult> {
  const github = await container.github();
  const agents = await container.agentsRepo.list(workspaceId);

  let degraded = false;
  const messages: string[] = [];
  const rejected: RefreshResult['rejected'] = [];

  for (const agent of agents) {
    const installations = (await container.ciRepo.listForAgent(agent.id)).filter(
      (installation) => installation.targetType === 'gha',
    );

    for (const installation of installations) {
      let repoRef;
      try {
        repoRef = parseRepoSlug(installation.repo);
      } catch {
        continue; // malformed repo slug on the installation row — not a GitHub API issue, just skip it
      }

      let runs;
      try {
        runs = await github.listWorkflowRuns(repoRef, { workflowFile: GHA_WORKFLOW_FILE_NAME });
      } catch (err) {
        degraded = true;
        messages.push(err instanceof Error ? err.message : 'GitHub API unavailable');
        continue;
      }

      for (const run of runs) {
        if (run.conclusion == null) continue; // still in-flight — no artifact to fetch yet

        try {
          const download = await github.downloadArtifact(repoRef, {
            runId: run.id,
            name: CI_RESULT_ARTIFACT_NAME,
          });
          if (download.contents.length === 0) continue; // missing/expired/empty artifact (AC-31)
          if (download.contents.length > MAX_ARTIFACT_BYTES) {
            rejected.push({ github_run_id: run.id, reason: 'artifact zip exceeds 1 MB' });
            continue;
          }
          const entry = readSingleZipEntry(download.contents, CI_RESULT_FILE_NAME);
          if (!entry.ok) {
            rejected.push({ github_run_id: run.id, reason: entry.reason });
            continue;
          }

          const parsedJson: unknown = JSON.parse(entry.json);
          // The artifact is a `CiResultArtifact[]` — one entry per reviewer in a
          // multi-agent export. Older single-agent runners wrote a bare object;
          // accept both by normalizing to an array.
          const asArray = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
          // Strict schema: an unknown key (e.g. a smuggled `api_key`) fails the parse.
          const result = CiResultArtifact.array().safeParse(asArray);
          if (!result.success || result.data.length === 0) {
            rejected.push({ github_run_id: run.id, reason: 'artifact failed schema validation' });
            continue;
          }

          // This installation belongs to ONE studio agent; pick that agent's
          // entry by slug — never fall back to a sole foreign entry.
          const agentSlug = slugFromName(agent.name);
          const artifact = result.data.find((a) => a.agent_slug === agentSlug);
          if (artifact == null) {
            rejected.push({ github_run_id: run.id, reason: `no entry for agent slug '${agentSlug}'` });
            continue;
          }

          // Authenticity (AC-60): runner output is untrusted until it agrees with
          // what GitHub itself reports for this workflow run.
          const mismatch = crossCheckArtifact(artifact, run, installation.repo);
          if (mismatch) {
            rejected.push({ github_run_id: run.id, reason: mismatch });
            continue;
          }

          // Same deterministic gate reviewer-core uses for local runs — never a
          // CI-specific reimplementation of severity ranking (AC-29).
          const findings = syntheticFindingsFromCounts(artifact);
          const blockers = countBlockers(findings, agent.ciFailOn);
          const triggered = gateTriggered(findings, agent.ciFailOn);
          void triggered; // `triggered === blockers > 0` by construction — kept for traceability/audit of AC-29's "reuse gateTriggered" requirement

          const status: CiRunStatus = artifact.findings_count === 0 ? 'no_findings' : 'succeeded';

          await container.reviewRepo.createCiAgentRun({
            workspaceId: agent.workspaceId,
            agentId: agent.id,
            prId: null, // CI-ingested runs are not matched to an internal `pull_requests` row (AC-28)
            ciInstallationId: installation.id,
            repo: installation.repo,
            externalPrNumber: artifact.pr_number ?? run.pullRequestNumber ?? null,
            actionsRunId: String(run.id),
            actionsJobUrl: run.htmlUrl,
            provider: null,
            model: null,
            status,
            durationMs: artifact.duration_ms ?? null,
            costUsd: artifact.cost_usd,
            findingsCount: artifact.findings_count,
            score: null, // the runner artifact carries no score field
            blockers,
          });
        } catch {
          // Download threw, JSON.parse threw, etc. — treat like any other
          // invalid/missing artifact: skip this run, keep going (AC-31). The
          // error text is deliberately not surfaced (AC-68).
          continue;
        }
      }
    }
  }

  return { degraded, message: messages.length > 0 ? messages.join('; ') : null, rejected };
}

/**
 * Compare the artifact's self-reported identity with GitHub's run metadata
 * (the trusted reference). Returns the first mismatch as a human-readable
 * reason, or null when everything agrees. A field absent on EITHER side is a
 * mismatch — fail closed.
 */
export function crossCheckArtifact(
  artifact: CiResultArtifact,
  run: WorkflowRunSummary,
  installationRepo: string,
): string | null {
  const lc = (v: string | null | undefined) => v?.toLowerCase();
  if (artifact.repository == null || lc(artifact.repository) !== lc(run.repositoryFullName)) {
    return 'repository does not match the workflow run';
  }
  if (lc(artifact.repository) !== lc(installationRepo)) {
    return 'repository does not match the installation';
  }
  if (artifact.repository_id == null || artifact.repository_id !== run.repositoryId) {
    return 'repository_id does not match the workflow run';
  }
  if (artifact.head_sha == null || lc(artifact.head_sha) !== lc(run.headSha)) {
    return 'head_sha does not match the workflow run';
  }
  if (artifact.pr_number == null || !(run.pullRequestNumbers ?? []).includes(artifact.pr_number)) {
    return 'pr_number does not match the workflow run';
  }
  return null;
}

/**
 * Build placeholder `Finding[]` from the artifact's aggregate severity counts
 * purely so `countBlockers`/`gateTriggered` (which take `Finding[]`) can be
 * reused verbatim — the artifact never carries individual findings (AC-29).
 * Content fields (file/line/rationale) are intentionally empty: only
 * `severity` feeds the gate computation.
 */
function syntheticFindingsFromCounts(artifact: CiResultArtifact): Finding[] {
  const bySeverity: [number, Finding['severity']][] = [
    [artifact.critical ?? 0, 'CRITICAL'],
    [artifact.warning ?? 0, 'WARNING'],
    [artifact.suggestion ?? 0, 'SUGGESTION'],
  ];
  const findings: Finding[] = [];
  let n = 0;
  for (const [count, severity] of bySeverity) {
    for (let i = 0; i < count; i++) {
      findings.push({
        id: `ci-synthetic-${n++}`,
        severity,
        category: 'bug',
        title: 'CI-ingested finding (aggregate count only)',
        file: '',
        start_line: 0,
        end_line: 0,
        rationale: '',
        confidence: 1,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (no dependency available — see server/insights/gotchas.md)
// ---------------------------------------------------------------------------
//
// GitHub Actions artifacts are plain PKZIP archives. Node's `zlib` module only
// exposes raw deflate/inflate primitives, not a ZIP container parser, and no
// zip library is a dependency of this package — adding one is out of scope
// (lockfile is off-limits). This hand-rolled reader supports exactly what's
// needed: a single named entry, size-capped.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

type ZipEntryResult = { ok: true; json: string } | { ok: false; reason: string };

/**
 * Read the archive's ONLY entry, which must be named exactly `entryName`
 * (AC-59). Rejects: anything but one entry, a different/nested name, a declared
 * inflated size over `MAX_ARTIFACT_BYTES` (zip-bomb guard — checked from the
 * central directory BEFORE inflating, and inflate itself is output-capped, so a
 * lying header cannot bypass it), and malformed archives.
 */
export function readSingleZipEntry(buf: Buffer, entryName: string): ZipEntryResult {
  const eocdOffset = buf.length < 22 ? -1 : findEocd(buf);
  if (eocdOffset < 0) return { ok: false, reason: 'artifact is not a valid zip' };

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  if (totalEntries !== 1) return { ok: false, reason: 'artifact zip must contain exactly one file' };

  const cursor = buf.readUInt32LE(eocdOffset + 16);
  if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CENTRAL_DIR_SIGNATURE) {
    return { ok: false, reason: 'artifact is not a valid zip' };
  }
  const compressionMethod = buf.readUInt16LE(cursor + 10);
  const compressedSize = buf.readUInt32LE(cursor + 20);
  const uncompressedSize = buf.readUInt32LE(cursor + 24);
  const nameLength = buf.readUInt16LE(cursor + 28);
  const localHeaderOffset = buf.readUInt32LE(cursor + 42);
  const name = buf.toString('utf8', cursor + 46, cursor + 46 + nameLength);

  if (name !== entryName) return { ok: false, reason: `artifact zip must contain only ${entryName}` };
  if (uncompressedSize > MAX_ARTIFACT_BYTES) return { ok: false, reason: 'artifact content exceeds 1 MB' };

  try {
    const bytes = readLocalFileData(buf, localHeaderOffset, compressionMethod, compressedSize);
    if (!bytes) return { ok: false, reason: 'artifact is not a valid zip' };
    return { ok: true, json: bytes.toString('utf8') };
  } catch {
    return { ok: false, reason: 'artifact content could not be inflated within the size cap' };
  }
}

/** Scan backward for the End Of Central Directory record (handles a trailing
 *  zip comment, which shifts it away from the very end of the buffer). */
function findEocd(buf: Buffer): number {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLength);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function readLocalFileData(
  buf: Buffer,
  localHeaderOffset: number,
  compressionMethod: number,
  compressedSize: number,
): Buffer | null {
  if (localHeaderOffset + 30 > buf.length) return null;
  if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) return null;

  const nameLength = buf.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > buf.length) return null;

  const data = buf.subarray(dataStart, dataEnd);
  if (compressionMethod === 0) return data.length <= MAX_ARTIFACT_BYTES ? Buffer.from(data) : null; // stored
  if (compressionMethod === 8) return inflateRawSync(data, { maxOutputLength: MAX_ARTIFACT_BYTES }); // deflate, output-capped
  return null; // unsupported method — treat like a missing/invalid artifact
}
