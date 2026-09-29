import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConventionCandidate, ConventionCategory, ConventionExtractionSummary } from '@devdigest/shared';
import type { ConventionExtractionRow, ConventionRow } from '../../db/rows.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { CONFIG_ALLOWLIST, EVIDENCE_LINE_TOLERANCE, MAX_RULE_CHARS } from './constants.js';

/**
 * Helpers for the conventions module — row ⇄ DTO mapping, line numbering,
 * evidence grounding, and the merge-to-skill markdown renderer, plus the
 * clone-local file reads that build their inputs (same precedent as
 * repo-intel's own `readClone`: local git-clone reads, no DB, no network).
 * The grounding/mapping/rendering functions are pure and unit-testable
 * against in-memory file contents; only the two sampling functions touch fs.
 */

// ---- row -> DTO -----------------------------------------------------------

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: (row.category ?? 'other') as ConventionCategory,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_line: row.evidenceLine,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status as ConventionCandidate['status'],
    edited: row.edited,
    skill_id: row.skillId,
  };
}

export function toExtractionDto(row: ConventionExtractionRow): ConventionExtractionSummary {
  return {
    id: row.id,
    status: row.status as ConventionExtractionSummary['status'],
    sampled_files: row.sampledFiles,
    candidates_raw: row.candidatesRaw,
    candidates_kept: row.candidatesKept,
    provider: row.provider,
    model: row.model,
    error: row.error,
    created_at: row.createdAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

// ---- line numbering ---------------------------------------------------------

/** Truncate to `maxLines` and prefix each line with its 1-based number. */
export function numberLines(body: string, maxLines: number): string {
  const lines = body.split('\n').slice(0, maxLines);
  return lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
}

// ---- package.json digest ---------------------------------------------------

/** Scripts + dependency NAMES only — never the full file (privacy + tokens). */
export function buildPackageJsonDigest(raw: string): string | null {
  try {
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    const deps = Object.keys((pkg.dependencies as Record<string, string> | undefined) ?? {});
    const devDeps = Object.keys((pkg.devDependencies as Record<string, string> | undefined) ?? {});
    return JSON.stringify({ scripts, dependencies: deps, devDependencies: devDeps }, null, 2);
  } catch {
    return null;
  }
}

// ---- sampling (clone-local reads; see file header) -------------------------

export interface ConfigFile {
  path: string;
  lines: string[];
}

export interface PickedConfigFiles {
  /** Citable config files (real content, real line numbers) — excludes package.json. */
  files: ConfigFile[];
  /** package.json's scripts+deps digest — extra context, never a citable path. */
  packageJsonDigest: string | null;
}

/**
 * Read the fixed config allowlist off the clone root. `package.json` is
 * special-cased into a digest (see `buildPackageJsonDigest`) rather than a
 * citable file, because its line numbers wouldn't match the digest text a
 * candidate might cite. A missing file is simply absent — never an error.
 */
export async function pickConfigFiles(clonePath: string, maxLines: number): Promise<PickedConfigFiles> {
  const files: ConfigFile[] = [];
  let packageJsonDigest: string | null = null;

  for (const name of CONFIG_ALLOWLIST) {
    const raw = await readFile(join(clonePath, name), 'utf8').catch(() => null);
    if (raw == null) continue;
    if (name === 'package.json') {
      packageJsonDigest = buildPackageJsonDigest(raw);
      continue;
    }
    files.push({ path: name, lines: raw.split('\n').slice(0, maxLines) });
  }

  return { files, packageJsonDigest };
}

export interface SourceSample {
  path: string;
  lines: string[];
}

/**
 * Read `paths` off the clone, truncated to `maxLines`, stopping once the
 * cumulative numbered-body token count would exceed `maxTokens` — a purely
 * code-side budget, no model involved. Always keeps at least one sample so a
 * single oversized file can't starve the whole extraction.
 */
export async function readSourceSamples(
  clonePath: string,
  paths: string[],
  tokenizer: Tokenizer,
  maxLines: number,
  maxTokens: number,
): Promise<SourceSample[]> {
  const out: SourceSample[] = [];
  let budget = 0;

  for (const path of paths) {
    const raw = await readFile(join(clonePath, path), 'utf8').catch(() => null);
    if (raw == null) continue;
    const lines = raw.split('\n').slice(0, maxLines);
    const tokens = tokenizer.count(numberLines(lines.join('\n'), maxLines));
    if (out.length > 0 && budget + tokens > maxTokens) break;
    budget += tokens;
    out.push({ path, lines });
  }

  return out;
}

// ---- grounding --------------------------------------------------------------

export interface RawConventionCandidate {
  category: string;
  rule: string;
  evidence: { path: string; line: number; snippet: string };
  confidence: number;
}

export interface GroundedConvention {
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export interface GroundConventionsResult {
  kept: GroundedConvention[];
  raw: number;
  droppedCount: number;
}

const VALID_CATEGORIES = new Set<string>([
  'naming',
  'error_handling',
  'module_structure',
  'async_style',
  'imports',
  'validation',
  'logging',
  'testing',
  'other',
]);

/** Collapse whitespace runs and trim — used for both snippet and rule matching. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Verify every candidate against the ACTUAL sampled file contents (the same
 * bodies shown to the model) and drop what can't be proven:
 *  - cited path not among the sampled files
 *  - evidence_line out of range
 *  - snippet doesn't appear within ±EVIDENCE_LINE_TOLERANCE lines of the cited
 *    line (whitespace-normalised)
 *  - rule empty/too long, confidence out of [0,1], or bad category
 *  - normalised rule text duplicates one already kept or an existing enabled
 *    skill body in the workspace
 * Nothing here ever throws — an unparsable candidate is simply dropped.
 */
export function groundConventions(
  candidates: RawConventionCandidate[],
  sampledFiles: ReadonlyMap<string, string[]>,
  existingSkillBodies: readonly string[],
): GroundConventionsResult {
  const kept: GroundedConvention[] = [];
  // Exact-match set for duplicates WITHIN this batch (a re-extracted rule is
  // typically worded identically); substring containment for existing skill
  // bodies, since a rule's sentence is one line inside a much longer body.
  const seenRules = new Set<string>();
  const existingNormalized = existingSkillBodies.map((b) => normalizeWhitespace(b).toLowerCase());
  let dropped = 0;

  for (const c of candidates) {
    if (!isGroundable(c, sampledFiles, seenRules, existingNormalized)) {
      dropped += 1;
      continue;
    }
    seenRules.add(normalizeWhitespace(c.rule).toLowerCase());
    kept.push({
      category: (VALID_CATEGORIES.has(c.category) ? c.category : 'other') as ConventionCategory,
      rule: c.rule.trim(),
      evidencePath: c.evidence.path,
      evidenceLine: c.evidence.line,
      evidenceSnippet: c.evidence.snippet,
      confidence: c.confidence,
    });
  }

  return { kept, raw: candidates.length, droppedCount: dropped };
}

function isGroundable(
  c: RawConventionCandidate,
  sampledFiles: ReadonlyMap<string, string[]>,
  seenRules: ReadonlySet<string>,
  existingNormalizedBodies: readonly string[],
): boolean {
  if (!c.rule || !c.rule.trim() || c.rule.length > MAX_RULE_CHARS) return false;
  if (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1) return false;
  if (!c.evidence || !c.evidence.path || !c.evidence.snippet) return false;

  const lines = sampledFiles.get(c.evidence.path);
  if (!lines) return false;
  if (!Number.isInteger(c.evidence.line) || c.evidence.line < 1 || c.evidence.line > lines.length) {
    return false;
  }

  if (isDuplicateRule(c.rule, seenRules, existingNormalizedBodies)) return false;
  return snippetMatches(lines, c.evidence.line, c.evidence.snippet);
}

function isDuplicateRule(
  rule: string,
  seenRules: ReadonlySet<string>,
  existingNormalizedBodies: readonly string[],
): boolean {
  const normalized = normalizeWhitespace(rule).toLowerCase();
  if (seenRules.has(normalized)) return true;
  return existingNormalizedBodies.some((body) => body.includes(normalized));
}

function snippetMatches(lines: string[], line: number, snippet: string): boolean {
  const from = Math.max(0, line - 1 - EVIDENCE_LINE_TOLERANCE);
  const to = Math.min(lines.length, line + EVIDENCE_LINE_TOLERANCE);
  const window = normalizeWhitespace(lines.slice(from, to).join(' '));
  return window.includes(normalizeWhitespace(snippet));
}

// ---- merge into a skill body -----------------------------------------------

const CATEGORY_LABELS: Record<ConventionCategory, string> = {
  naming: 'Naming',
  error_handling: 'Error handling',
  module_structure: 'Module structure',
  async_style: 'Async style',
  imports: 'Imports',
  validation: 'Validation',
  logging: 'Logging',
  testing: 'Testing',
  other: 'Other',
};

/** One `##` section per accepted convention, under a directive header. */
export function mergeToSkillBody(accepted: ConventionCandidate[]): string {
  const header =
    'Flag changes that violate any rule below and cite the offending `file:line`.\n';
  const sections = accepted.map((c) => {
    const label = CATEGORY_LABELS[c.category] ?? 'Other';
    const location = c.evidence_line != null ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path;
    return [
      `## ${label}: ${c.rule}`,
      '',
      `Detected in \`${location}\``,
      '',
      '```',
      c.evidence_snippet,
      '```',
    ].join('\n');
  });
  return [header, ...sections].join('\n\n');
}
