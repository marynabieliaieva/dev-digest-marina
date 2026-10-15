# Report template

Fill the five sections in this order with these exact headings so reports are diffable.
Numbers in MB with one decimal; percentages as whole numbers. If a subsection has no data, keep
the heading and write one line ("Vulnerabilities: not checked — offline run").

````markdown
# Dependency report — <repo name> — <YYYY-MM-DD>

## 1. Scope
- **Analyzed packages:** `<package>` (pnpm, 22 prod / 8 dev), … — one line each, all packages found
- **Run:** offline | online, collector v1.1.0; sizes are installed files on disk, not bundle size
- **Not measured:** <vulnerabilities / outdated if offline; bundle size; anything skipped>
- **Layout note:** not a monorepo — standalone packages joined by path aliases and `vendor/` copies

## 2. Dependency graph
```mermaid
flowchart LR
<mermaid.packages from the JSON; keep internal links (aliases, bypasses, local copies)
 visually apart from external npm packages — e.g. a `subgraph External` for heavy npm deps>
```
**Internal dependencies** (this repo's own code):
| From | To | How | Imports |
|---|---|---|---|
| reviewer-core | api (`server/src/vendor/shared`) | alias `@devdigest/shared` | 26 |
| reviewer-core | api (`server/src/adapters/mocks.js`) | **relative import bypassing the alias** | 2 |

**Module graph** (only where `moduleGraph` has edges): mermaid from `mermaid.modules[i]`, then
`Cycles: smart-diff → reviews → smart-diff` or `none`.

## 3. Size breakdown
### <package> — <prod MB> MB prod, <n> packages (+dev: <MB>)
| # | Dependency | Kind | Own MB | With deps MB | Share of package | Imports |
|---|---|---|---|---|---|---|
(top 10 by "With deps"; share = With deps ÷ package prod total; the column does not add to 100%)

## 4. Findings & Priorities
### P0 — do now
| Finding | Package | Evidence | Recommendation (confirm first) |
### P1 — this sprint
### P2 — plan it
### Info
(Each row: type label — unused dependency | version drift | duplicate | boundary bypass | cycle |
outdated | vulnerability | license | manifest hygiene — then package, evidence, fix. Empty tier: "none".)

## 5. Summary
1. <highest priority action — package, file, impact, effort>
2. …
(3–5 items ordered by priority; recommendations only, nothing executed)
````

## Style rules
- A developer should be able to stop after section 5 and know what to do — keep it concrete.
- One finding = one row = one recommendation. Group by tier, then by package.
- Commands in the recommendation column are suggestions in code formatting; never execute them.
