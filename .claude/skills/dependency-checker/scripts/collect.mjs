#!/usr/bin/env node
// Collects dependency facts for every package in a repo and writes one JSON file.
// Usage: node collect.mjs [--root <dir>] [--out <file.json>] [--online]
//   --online  also run `outdated` and `audit` (needs network; each step has a timeout)
// Output is data only — turning it into a report is the skill's job.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const ROOT = path.resolve(opt('--root', process.cwd()));
const OUT = path.resolve(opt('--out', path.join(ROOT, '.claude', 'tmp', 'dependency-checker.json')));
const ONLINE = args.includes('--online');

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-e2e', 'dist', 'build', 'coverage', 'clones', 'test-results', '.claude', '.turbo', 'out']);
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const IMPLICIT = new Set(['typescript', 'tsx', 'vitest', 'drizzle-kit', 'react', 'react-dom', 'next', 'tailwindcss', 'postcss', '@tailwindcss/postcss', 'dependency-cruiser']);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readJsonc = (f) => {
  try {
    const src = fs.readFileSync(f, 'utf8');
    let out = '';
    for (let i = 0, str = false; i < src.length; i++) {
      const c = src[i];
      if (str) { out += c; if (c === '\\') out += src[++i]; else if (c === '"') str = false; continue; }
      if (c === '"') { str = true; out += c; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
      out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch { return null; }
};
const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

function walk(dir, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, visit); }
    else visit(full);
  }
}

// ---- 1. discover packages (root + one level down) ----
function discoverPackages() {
  const found = [];
  const tryDir = (d) => {
    const pj = readJson(path.join(d, 'package.json'));
    if (pj) found.push({ dir: d, pj });
  };
  tryDir(ROOT);
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) tryDir(path.join(ROOT, e.name));
  }
  return found;
}

function managerOf(dir) {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'unknown';
}

// ---- 2. installed package resolution + sizes ----
const ownSizeMemo = new Map();
function ownSize(pkgDir) {
  if (ownSizeMemo.has(pkgDir)) return ownSizeMemo.get(pkgDir);
  let total = 0;
  const rec = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (e.name !== 'node_modules') rec(full); }
      else { try { total += fs.statSync(full).size; } catch { /* ignore */ } }
    }
  };
  rec(pkgDir);
  ownSizeMemo.set(pkgDir, total);
  return total;
}

function resolveDep(name, fromDir) {
  let cur = fromDir;
  for (;;) {
    const cands = [path.join(cur, 'node_modules', name)];
    if (path.basename(cur) === 'node_modules') cands.push(path.join(cur, name));
    for (const c of cands) { const r = real(c); if (r && fs.existsSync(path.join(r, 'package.json'))) return r; }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

const closureMemo = new Map();
function closure(pkgDir, seen = new Set()) {
  if (seen.has(pkgDir)) return seen;
  seen.add(pkgDir);
  const pj = readJson(path.join(pkgDir, 'package.json')) || {};
  const names = [...Object.keys(pj.dependencies || {}), ...Object.keys(pj.optionalDependencies || {})];
  for (const n of names) { const r = resolveDep(n, pkgDir); if (r) closure(r, seen); }
  return seen;
}
function closureOf(pkgDir) {
  if (!closureMemo.has(pkgDir)) closureMemo.set(pkgDir, closure(pkgDir));
  return closureMemo.get(pkgDir);
}

// ---- 3. duplicates (same package, several installed versions) ----
function duplicates(dir, manager) {
  const versions = new Map();
  const add = (name, v) => { if (!versions.has(name)) versions.set(name, new Set()); versions.get(name).add(v); };
  const nm = path.join(dir, 'node_modules');
  if (manager === 'pnpm') {
    const store = path.join(nm, '.pnpm');
    if (fs.existsSync(store)) {
      for (const e of fs.readdirSync(store)) {
        const m = e.match(/^(@?[^@]+?)@(\d[^_(]*)/);
        if (m) add(m[1].replace('+', '/'), m[2]);
      }
    }
  } else if (fs.existsSync(nm)) {
    const scan = (modDir, depth) => {
      for (const e of fs.readdirSync(modDir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(modDir, e.name);
        if (e.name.startsWith('@') && e.isDirectory()) { scan(full, depth); continue; }
        const pj = readJson(path.join(full, 'package.json'));
        if (pj?.name && pj.version) add(pj.name, pj.version);
        const nested = path.join(full, 'node_modules');
        if (depth < 4 && fs.existsSync(nested)) scan(nested, depth + 1);
      }
    };
    scan(nm, 0);
  }
  return [...versions].filter(([, s]) => s.size > 1).map(([name, s]) => ({ name, versions: [...s].sort() }));
}

// ---- 4. import scan ----
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
function bare(spec) {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
function scanImports(pkgDir) {
  const used = new Map();
  const raw = [];
  walk(pkgDir, (f) => {
    if (!CODE_EXT.test(f)) return;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
    for (const m of text.matchAll(IMPORT_RE)) {
      raw.push({ file: path.relative(pkgDir, f).split(path.sep).join('/'), spec: m[1] });
      const b = bare(m[1]);
      if (b) used.set(b, (used.get(b) || 0) + 1);
    }
  });
  return { used, raw };
}
function toolingText(pkgDir, pj) {
  let text = JSON.stringify(pj.scripts || {});
  for (const e of fs.readdirSync(pkgDir, { withFileTypes: true })) {
    if (e.isFile() && /\.(config|rc)\.|^\.|\.json$/.test(e.name) && e.name !== 'package.json' && !/lock/.test(e.name)) {
      try { text += fs.readFileSync(path.join(pkgDir, e.name), 'utf8').slice(0, 20000); } catch { /* ignore */ }
    }
  }
  return text;
}

// ---- 5. internal edges ----
function owningPackage(absTarget, pkgs) {
  let best = null;
  for (const p of pkgs) {
    if ((absTarget + path.sep).startsWith(p.dir + path.sep) && (!best || p.dir.length > best.dir.length)) best = p;
  }
  return best;
}
function internalEdges(pkgs, scans) {
  const edges = [];
  for (const p of pkgs) {
    const ts = readJsonc(path.join(p.dir, 'tsconfig.json'));
    const paths = ts?.compilerOptions?.paths || {};
    const baseUrl = path.resolve(p.dir, ts?.compilerOptions?.baseUrl || '.');
    for (const [alias, targets] of Object.entries(paths)) {
      const key = alias.replace(/\/\*$/, '');
      if (alias.endsWith('/*') && paths[key]) continue;
      const target = path.resolve(baseUrl, String(targets[0]).replace(/\/\*$/, ''));
      if (target.includes(`${path.sep}node_modules`)) continue;
      const owner = owningPackage(target, pkgs);
      const imports = scans.get(p.dir).raw.filter((r) => r.spec === key || r.spec.startsWith(key + '/')).length;
      const sameDir = owner?.dir === p.dir;
      if (sameDir && (key === '@' || key === '~' || key.startsWith('@/'))) continue;
      edges.push({
        from: p.pj.name || path.basename(p.dir),
        to: owner ? (owner.pj.name || path.basename(owner.dir)) : path.relative(ROOT, target),
        alias: key,
        targetPath: path.relative(ROOT, target).split(path.sep).join('/'),
        kind: sameDir ? 'local-copy' : 'cross-package',
        imports,
      });
    }
  }
  return edges;
}

// Relative imports that leave the package: the file reaches into another package's source by path
// instead of through an alias/public entry point.
function boundaryBypasses(pkgs, scans) {
  const out = [];
  for (const p of pkgs) {
    for (const r of scans.get(p.dir).raw) {
      if (!r.spec.startsWith('.')) continue;
      const abs = path.resolve(p.dir, path.dirname(r.file), r.spec);
      const owner = owningPackage(abs, pkgs);
      if (owner && owner.dir !== p.dir) {
        out.push({
          from: p.pj.name || path.basename(p.dir), file: r.file, spec: r.spec,
          to: owner.pj.name || path.basename(owner.dir),
          targetPath: path.relative(ROOT, abs).split(path.sep).join('/'),
        });
      }
    }
  }
  return out;
}

function moduleGraph(pkgs, scans) {
  const out = [];
  for (const p of pkgs) {
    const modRoot = path.join(p.dir, 'src', 'modules');
    if (!fs.existsSync(modRoot)) continue;
    const names = fs.readdirSync(modRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const counts = new Map();
    for (const r of scans.get(p.dir).raw) {
      const m = r.file.match(/^src\/modules\/([^/]+)\//);
      if (!m) continue;
      const t = r.spec.match(/^(?:\.\.\/)+([^/.][^/]*)\//) || r.spec.match(/^\.\.\/\.\.\/modules\/([^/]+)\//);
      const to = t && names.includes(t[1]) ? t[1] : null;
      if (to && to !== m[1]) counts.set(`${m[1]}>${to}`, (counts.get(`${m[1]}>${to}`) || 0) + 1);
    }
    const edges = [...counts].map(([k, n]) => { const [from, to] = k.split('>'); return { from, to, imports: n }; });
    const adj = new Map(names.map((n) => [n, edges.filter((e) => e.from === n).map((e) => e.to)]));
    const cycles = [];
    const state = new Map();
    const stack = [];
    const dfs = (n) => {
      state.set(n, 1); stack.push(n);
      for (const t of adj.get(n) || []) {
        if (state.get(t) === 1) cycles.push([...stack.slice(stack.indexOf(t)), t]);
        else if (!state.get(t)) dfs(t);
      }
      stack.pop(); state.set(n, 2);
    };
    names.forEach((n) => { if (!state.get(n)) dfs(n); });
    out.push({ package: p.pj.name || path.basename(p.dir), modules: names, edges, cycles });
  }
  return out;
}

// ---- 6. optional online data ----
function run(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { error: String(r.error.message || r.error) };
  try { return { data: JSON.parse(r.stdout) }; } catch { return { error: (r.stderr || r.stdout || 'no output').slice(0, 300) }; }
}
function onlineData(p) {
  const pnpm = p.manager === 'pnpm';
  return {
    outdated: run(pnpm ? 'pnpm outdated --format json' : 'npm outdated --json', p.dir),
    audit: run(pnpm ? 'pnpm audit --json' : 'npm audit --json', p.dir),
  };
}

// ---- main ----
const MB = (b) => Math.round((b / 1048576) * 100) / 100;
const pkgs = discoverPackages().map((p) => ({ ...p, manager: managerOf(p.dir) }));
const scans = new Map(pkgs.map((p) => [p.dir, scanImports(p.dir)]));

const packages = pkgs.map((p) => {
  const installed = fs.existsSync(path.join(p.dir, 'node_modules'));
  const tooling = toolingText(p.dir, p.pj);
  const { used } = scans.get(p.dir);
  const kinds = [['dependencies', 'prod'], ['devDependencies', 'dev'], ['peerDependencies', 'peer'], ['optionalDependencies', 'optional']];
  const deps = [];
  for (const [field, kind] of kinds) {
    for (const [name, range] of Object.entries(p.pj[field] || {})) {
      const dir = installed ? resolveDep(name, p.dir) : null;
      const pj = dir ? readJson(path.join(dir, 'package.json')) : null;
      const cl = dir ? closureOf(dir) : null;
      const closureBytes = cl ? [...cl].reduce((s, d) => s + ownSize(d), 0) : null;
      const baseName = name.startsWith('@types/') ? name.slice(7).replace('__', '/') : null;
      const imports = used.get(name) || 0;
      const mentioned = tooling.includes(name);
      const implicit = IMPLICIT.has(name) || (baseName && (used.has(baseName) || baseName === 'node'));
      deps.push({
        name, range, kind,
        version: pj?.version ?? null,
        license: typeof pj?.license === 'string' ? pj.license : pj?.license?.type ?? null,
        ownMB: dir ? MB(ownSize(dir)) : null,
        transitiveMB: closureBytes != null ? MB(closureBytes) : null,
        transitiveCount: cl ? cl.size - 1 : null,
        imports,
        unusedCandidate: kind !== 'peer' && imports === 0 && !mentioned && !implicit,
      });
    }
  }
  if (installed) {
    for (const d of deps.filter((x) => x.unusedCandidate)) {
      const dir = resolveDep(d.name, p.dir);
      d.requiredBy = deps
        .filter((o) => o.name !== d.name)
        .filter((o) => { const od = resolveDep(o.name, p.dir); return od && dir && closureOf(od).has(dir); })
        .map((o) => o.name);
    }
  }
  const prod = deps.filter((d) => d.kind === 'prod');
  const allClosure = new Set();
  if (installed) for (const d of deps.filter((x) => x.kind === 'prod' || x.kind === 'optional')) {
    const dir = resolveDep(d.name, p.dir); if (dir) closureOf(dir).forEach((x) => allClosure.add(x));
  }
  const allDev = new Set(allClosure);
  if (installed) for (const d of deps.filter((x) => x.kind === 'dev')) {
    const dir = resolveDep(d.name, p.dir); if (dir) closureOf(dir).forEach((x) => allDev.add(x));
  }
  const sum = (set) => MB([...set].reduce((s, d) => s + ownSize(d), 0));
  return {
    name: p.pj.name || path.basename(p.dir),
    dir: path.relative(ROOT, p.dir).split(path.sep).join('/') || '.',
    manager: p.manager,
    installed,
    counts: { prod: prod.length, dev: deps.filter((d) => d.kind === 'dev').length, peer: deps.filter((d) => d.kind === 'peer').length, optional: deps.filter((d) => d.kind === 'optional').length },
    totals: installed ? { prodClosureMB: sum(allClosure), prodPlusDevClosureMB: sum(allDev), prodClosurePackages: allClosure.size } : null,
    duplicates: installed ? duplicates(p.dir, p.manager) : [],
    deps: deps.sort((a, b) => (b.transitiveMB ?? -1) - (a.transitiveMB ?? -1)),
    online: ONLINE ? onlineData(p) : null,
  };
});

const drift = [];
{
  const byName = new Map();
  for (const p of packages) for (const d of p.deps) {
    if (!d.version) continue;
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push({ package: p.name, kind: d.kind, range: d.range, version: d.version });
  }
  for (const [name, entries] of byName) {
    if (new Set(entries.map((e) => e.version)).size > 1) drift.push({ name, entries });
  }
  drift.sort((a, b) => b.entries.length - a.entries.length);
}

const edges = internalEdges(pkgs, scans);
const modules = moduleGraph(pkgs, scans);
const bypasses = boundaryBypasses(pkgs, scans);

const id = (s) => s.replace(/[^a-zA-Z0-9]/g, '_');
const mermaid = {
  packages: ['flowchart LR', ...packages.map((p) => `  ${id(p.name)}["${p.name}<br/>${p.counts.prod} prod / ${p.counts.dev} dev${p.totals ? `<br/>${p.totals.prodClosureMB} MB prod` : ''}"]`),
    ...edges.filter((e) => e.kind === 'local-copy').map((e) => `  ${id(e.targetPath)}[("${e.targetPath}<br/>local copy")]`),
    ...edges.filter((e) => e.imports > 0).map((e) => `  ${id(e.from)} -->|"${e.alias} (${e.imports})"| ${e.kind === 'local-copy' ? id(e.targetPath) : id(e.to)}`)].join('\n'),
  modules: modules.map((m) => ({ package: m.package, diagram: ['flowchart LR', ...m.modules.map((n) => `  ${id(n)}["${n}"]`), ...m.edges.map((e) => `  ${id(e.from)} -->|${e.imports}| ${id(e.to)}`)].join('\n') })),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), root: ROOT, online: ONLINE, packages, versionDrift: drift, internalEdges: edges, boundaryBypasses: bypasses, moduleGraph: modules, mermaid }, null, 2));
console.log(`wrote ${OUT}`);
console.log(packages.map((p) => `${p.name.padEnd(28)} ${p.manager.padEnd(5)} prod:${String(p.counts.prod).padStart(3)} dev:${String(p.counts.dev).padStart(3)}  ${p.totals ? p.totals.prodClosureMB + ' MB prod closure' : 'not installed'}`).join('\n'));
