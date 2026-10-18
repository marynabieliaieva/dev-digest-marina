# collect.mjs output — field guide

Top level: `generatedAt`, `root`, `online`, `packages[]`, `versionDrift[]`, `internalEdges[]`, `boundaryBypasses[]`, `moduleGraph[]`, `mermaid`.

## packages[]
| Field | Meaning |
|---|---|
| `name`, `dir`, `manager` | package name, path from repo root, `pnpm`/`npm`/`yarn`/`bun`/`unknown` (from the lockfile) |
| `installed` | `node_modules` exists. If false, all sizes are null — do not estimate |
| `counts` | declared deps by kind: prod, dev, peer, optional |
| `totals.prodClosureMB` | size of prod deps **plus everything they pull in**, each package counted once |
| `totals.prodPlusDevClosureMB` | same including dev deps (what a developer machine holds) |
| `totals.prodClosurePackages` | how many distinct packages are in the prod closure |
| `duplicates[]` | `{name, versions[]}` — same package installed in several versions |
| `deps[]` | one entry per declared dependency, sorted by `transitiveMB` desc |
| `online` | `{outdated, audit}` raw tool output (`{data}` or `{error}`); null when run offline |

### deps[]
`name, range, kind, version` (installed), `license`, `ownMB` (the package alone),
`transitiveMB` (it + its prod dependency tree), `transitiveCount`, `imports` (how many import
statements in the package's sources name it), `unusedCandidate` (heuristic — always verify),
`requiredBy` (only on candidates: other declared deps that already pull it in).

## boundaryBypasses[]
Relative imports that leave the package: `{from, file, spec, to, targetPath}` — the file reaches into another
package's source by path instead of its alias/public entry. Test files count too; say so when all hits are tests.

## versionDrift[]
Dependencies declared in several packages that resolve to **different installed versions**:
`{name, entries[{package, kind, range, version}]}`. With no workspace, each package pins its own
copy, so a bump needs coordinated edits — list them together, never one package at a time.

## internalEdges[]
Derived from `tsconfig` `paths`: `{from, to, alias, targetPath, kind, imports}`.
`kind: cross-package` = the alias points into another package's source (consumed as TS source, not
built). `kind: local-copy` = the alias points inside the same package (e.g. a manually duplicated
`vendor/shared`). `imports` = number of import statements using the alias.

## moduleGraph[]
For packages with `src/modules/*`: `{package, modules[], edges[{from,to,imports}], cycles[][]}`.
A cycle is listed as `[a, b, a]`. Edges come from relative imports between module folders.

## mermaid
Ready-made diagrams: `mermaid.packages` (package graph) and `mermaid.modules[]` (one per package).
Paste into a fenced ```mermaid block; add colors/classes only if it improves readability.

## Known blind spots
- Import scan is regex-based: it misses imports built from variables and counts `import type` too.
- `unusedCandidate` cannot see usage via CLI binaries in CI, Docker or shell scripts outside the package.
- Sizes ignore tree-shaking, compression and platform-specific optional binaries not installed locally.
- Module edges only recognize relative `../<module>/` imports.
