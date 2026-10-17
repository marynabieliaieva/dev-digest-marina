---
name: dependency-checker
description: >
  Audits every dependency in the repository and its packages: maps who depends on what
  (package-to-package and module-to-module diagrams, internal path-alias links kept apart from
  npm packages), measures how much each dependency weighs on disk (own size and transitive size),
  finds unused, duplicated, version-drifting, outdated or vulnerable packages, and ends with a
  prioritized list of actions. Use this skill whenever the user asks to check, audit, review,
  analyze or clean up dependencies, package.json, lockfiles, node_modules size, install weight,
  "what depends on what", dependency graphs or cycles, unused packages, duplicate versions, or
  whether to upgrade or remove a package — even if they do not say "dependency checker". Also use
  it before adding a heavy new package to judge its cost, and when asked "why is node_modules so big".
version: "1.1.1"
---

# Dependency Checker

Produces one structured report on the repo's dependencies in exactly **five sections**:
**Scope → Dependency graph → Size breakdown → Findings & Priorities → Summary**.
The numbers come from a script (deterministic, reproducible). Your job is to verify its
candidates, interpret them for *this* repo, and write the report in the fixed layout so
developers can skim it and act.

## Workflow

1. **Collect** — from the repo root (read-only; it writes one JSON file):
   ```bash
   node .claude/skills/dependency-checker/scripts/collect.mjs            # offline, ~40 s
   node .claude/skills/dependency-checker/scripts/collect.mjs --online   # + outdated + audit (network)
   ```
   Output: `.claude/tmp/dependency-checker.json` (override with `--out`). Use `--online` when the
   user cares about upgrades or security. If you run offline, the report must say so: security
   and freshness are then **not checked**, which is different from "clean". If a package has
   `installed: false`, its sizes are unknown — say so instead of guessing.
   **No shell tool, or data supplied inline?** Use the facts you were given (package.json lists,
   sizes, import greps) and produce the same five sections from them. Never invent a number;
   write "not measured" for anything you were not given.
2. **Read the JSON** — field meanings are in [references/data-format.md](references/data-format.md).
3. **Verify candidates before reporting them.** `unusedCandidate` is a heuristic (import scan +
   config/script mentions). For each one, grep the package for the name (dynamic imports, config
   strings, CLI use in scripts) and read `requiredBy`: if another declared dependency already pulls
   it in, removing the explicit entry will not shrink the install. Report only what survives;
   label the rest "needs confirmation".
4. **Prioritize** with [references/prioritization.md](references/prioritization.md) — a fixed rubric
   (P0 / P1 / P2 / Info) so two runs rank the same facts the same way.
5. **Write the report** using [references/report-template.md](references/report-template.md), sections
   in the order below. Print it in chat; also save it to `.claude/tmp/dependency-report.md` unless
   the user names another path.

## Report layout (fixed — do not reorder, rename or drop sections)

| # | Section | Content |
|---|---|---|
| 1 | **Scope** | which packages were analyzed (manager, prod/dev counts), run mode (offline/online), what was *not* measured |
| 2 | **Dependency graph** | Mermaid `flowchart`: internal links (path aliases, relative bypasses, local copies) drawn apart from external npm packages; module graph + cycles where they exist |
| 3 | **Size breakdown** | per package a table of dependencies with own MB, with-deps MB and share of the package total |
| 4 | **Findings & Priorities** | every finding under a tier **P0 / P1 / P2 / Info**: unused, version drift, duplicates, boundary bypasses, cycles, outdated, vulnerabilities, licenses, manifest hygiene |
| 5 | **Summary** | 3–5 takeaways ordered by priority, each a concrete action naming a package and file |

## Rules that keep the report trustworthy

- **Internal vs external is the first distinction.** This repo is **not a monorepo**: packages are
  standalone with their own lockfiles and share code through tsconfig path aliases (`@devdigest/shared`,
  `@devdigest/reviewer-core`) and manual `vendor/` copies. Never describe these as `workspace:*` or
  pnpm-workspace links. A relative import that reaches into another package's source
  (`boundaryBypasses` in the JSON) is a boundary violation, not a normal dependency.
- **Sizes are on-disk size of installed files, not bundle size.** A 133 MB `next` does not ship 133 MB
  to browsers. Say "install weight", never "bundle size".
- **Transitive MB double-counts shared packages** across rows; per-package `totals.*` do not. Compute
  shares against the package total, and never sum the rows of a table.
- **Every finding needs evidence** — the package, the number, and where you looked (file or field).
- **Use the repo's words:** *version drift* (same dependency, different versions across packages),
  *unused dependency* (declared, never imported), *duplicate* (several versions installed in one package).
- **Recommendations, not actions.** The skill reports; removing or upgrading packages is a separate step
  the user confirms. Phrase fixes as "recommend removing X — confirm first" with the command in code
  formatting, and never edit lockfiles (see the repo's "Do not touch" list).
- Keep advice specific: name the package and the action ("replace `mermaid` (72 MB) with a dynamic
  import" is advice; "reduce dependencies" is not).
