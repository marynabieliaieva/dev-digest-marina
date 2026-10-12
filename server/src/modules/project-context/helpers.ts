import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  DOC_TYPES,
  EXCLUDED_DIRS,
  MAX_DOC_BYTES,
  MAX_PATH_LEN,
  RUN_TOKEN_BUDGET,
} from './constants.js';

/**
 * Helpers for the project-context module. Everything is pure except the two
 * filesystem functions at the bottom (`walkDocs`, `readDocConfined`), which are
 * confined to a repo clone root and never follow symlinks.
 */

export type DocType = (typeof DOC_TYPES)[number];

// ---- glob matching --------------------------------------------------------

const REGEX_META = /[.+^$()|[\]\\{}]/g;

/** Glob -> anchored RegExp. Supports `**`, `*`, `?` and `{a,b}` alternation. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      braceDepth++;
      out += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      out += ')';
    } else if (c === ',' && braceDepth > 0) {
      out += '|';
    } else {
      out += c.replace(REGEX_META, '\\$&');
    }
  }
  while (braceDepth-- > 0) out += ')';
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

// ---- path rules -----------------------------------------------------------

/**
 * Shape-only validation of a repo-relative `.md` path. Also rejects `"`, `<`,
 * `>` and control characters so a path can never break out of the
 * `<untrusted source="…">` label (this only narrows accepted input).
 */
export function isSafeRelPath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATH_LEN) return false;
  if (p.includes('\\')) return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  if (/["<>]/.test(p) || /[\u0000-\u001f]/.test(p)) return false;
  if (!p.endsWith('.md')) return false;
  for (const s of p.split('/')) {
    if (s === '' || s === '.' || s === '..') return false;
  }
  return true;
}

/** First directory segment that is specs/docs/insights; `docs` when none matches. */
export function docType(path: string): DocType {
  const dirs = path.split('/').slice(0, -1);
  for (const seg of dirs) {
    if ((DOC_TYPES as readonly string[]).includes(seg)) return seg as DocType;
  }
  return 'docs';
}

/** Same chars/4 heuristic as reviewer-core `sectionStats`. */
export function estTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---- effective list -------------------------------------------------------

export type EffectiveEntry = { path: string; origin: 'agent' | 'skill'; skill_name?: string };

/**
 * Agent paths first, then each skill's paths in the given order; first
 * occurrence of a path wins. The caller passes only enabled skills/links.
 */
export function mergeEffective(
  agentPaths: string[],
  skills: { name: string; paths: string[] }[],
): EffectiveEntry[] {
  const seen = new Set<string>();
  const out: EffectiveEntry[] = [];
  for (const path of agentPaths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, origin: 'agent' });
  }
  for (const skill of skills) {
    for (const path of skill.paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, origin: 'skill', skill_name: skill.name });
    }
  }
  return out;
}

// ---- size / budget pass ---------------------------------------------------

export type BudgetStatus = 'included' | 'missing' | 'too_large' | 'over_budget' | 'unreadable';

export type BudgetInput<T extends { path: string }> = T & {
  bytes: number;
  content: string | null;
  /** Set when the document could not be read. */
  readError?: 'missing' | 'unreadable' | 'too_large';
};

export type BudgetResult<T> = T & { status: BudgetStatus; est_tokens: number };

/**
 * Assigns a status to each doc in order. Over-budget docs are skipped but
 * evaluation continues, so a later smaller doc can still fit (AC-29).
 */
export function applyBudget<T extends { path: string }>(
  docs: BudgetInput<T>[],
): BudgetResult<BudgetInput<T>>[] {
  let running = 0;
  return docs.map((d) => {
    if (d.readError === 'missing') return { ...d, status: 'missing', est_tokens: 0 };
    if (d.readError === 'unreadable') return { ...d, status: 'unreadable', est_tokens: 0 };
    if (d.readError === 'too_large' || d.bytes > MAX_DOC_BYTES) {
      return { ...d, status: 'too_large', est_tokens: Math.ceil(d.bytes / 4) };
    }
    if (d.content === null) return { ...d, status: 'unreadable', est_tokens: 0 };
    const est = estTokens(d.content);
    if (running + est > RUN_TOKEN_BUDGET) {
      return { ...d, status: 'over_budget', est_tokens: est };
    }
    running += est;
    return { ...d, status: 'included', est_tokens: est };
  });
}

// ---- filesystem (confined to a clone root) --------------------------------

export type WalkedDoc = { path: string; size: number; mtime: Date; content: string };

/**
 * Lists regular `.md` files under `root` matching `globs`. Skips excluded dirs
 * and every symlink (files and dirs alike). Sorted by path.
 */
export async function walkDocs(root: string, globs: string[]): Promise<WalkedDoc[]> {
  const regexes = globs.map(globToRegExp);
  const out: WalkedDoc[] = [];

  async function walk(absDir: string, relDir: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const abs = resolve(absDir, e.name);
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.includes(e.name)) continue;
        await walk(abs, rel);
      } else if (e.isFile() && rel.endsWith('.md') && regexes.some((r) => r.test(rel))) {
        try {
          const [st, buf] = await Promise.all([lstat(abs), readFile(abs)]);
          out.push({ path: rel, size: st.size, mtime: st.mtime, content: buf.toString('utf8') });
        } catch {
          // vanished or unreadable between readdir and read: skip silently
        }
      }
    }
  }

  await walk(resolve(root), '');
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

export type ConfinedRead =
  | { status: 'ok'; content: string; bytes: number }
  | { status: 'missing' }
  | { status: 'unreadable' }
  | { status: 'too_large'; bytes: number };

function insideRoot(realRoot: string, candidate: string): boolean {
  const norm = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const prefix = norm(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  return norm(candidate).startsWith(prefix);
}

/**
 * Reads one document from the clone. Rejects unsafe paths, anything resolving
 * outside the root, symlinks and non-files, oversized files (without reading)
 * and invalid UTF-8.
 */
export async function readDocConfined(root: string, relPath: string): Promise<ConfinedRead> {
  if (!isSafeRelPath(relPath)) return { status: 'unreadable' };
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return { status: 'missing' };
  }
  const abs = resolve(realRoot, relPath);
  if (!insideRoot(realRoot, abs)) return { status: 'unreadable' };

  let st;
  try {
    st = await lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { status: 'missing' } : { status: 'unreadable' };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { status: 'unreadable' };

  try {
    // A symlinked parent directory would still pass the lexical check above.
    if (!insideRoot(realRoot, await realpath(abs))) return { status: 'unreadable' };
    if (st.size > MAX_DOC_BYTES) return { status: 'too_large', bytes: st.size };
    const buf = await readFile(abs);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { status: 'ok', content, bytes: buf.length };
  } catch {
    return { status: 'unreadable' };
  }
}
