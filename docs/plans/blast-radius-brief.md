# Blast Radius (L04) — implementation plan via the agent pipeline

## Context

A reviewer sees the diff but not what else in the repo the change can affect. The `repo-intel`
index has already computed everything: `container.repoIntel.getBlastRadius(repoId, changedFiles)`
returns a `BlastResult` (flat `callers[]` with `viaSymbol`, `factsByFile`, `degraded`/`reason`).
Missing pieces: a `blast/` server module with `GET /pulls/:id/blast` that maps `BlastResult` →
the `BlastRadius` contract; a block on the PR Overview tab; a working `devdigest_get_blast_radius`
MCP tool instead of the stub. No LLM, no re-parsing.
Scope: all P1 + P2; from P3 only the **Tree / Graph toggle**.

## Step 0 (first action after approval)

Save this plan in the repo as `docs/plans/blast-radius-brief.md` — it is the input for `planner`.

## Agent pipeline (all already exist in `.claude/agents/`)

```
planner ──► docs/plans/blast-radius.md
   │
   ├─ W1: implementer T1 (contract)
   ├─ W2: implementer T2 (server) ∥ implementer T4 (hook) ∥ implementer T6 (MCP)
   ├─ W3: test-writer T3 (server tests) ∥ implementer T5 (UI + its tests)
   ▼
architecture-reviewer ∥ plan-verifier   (read-only, in parallel)
   ▼
orchestrator: full test run → pr-self-review skill (the only gate) → PR
   ▼
doc-writer → docs/features/blast-radius/ (optional)
```

1. **planner** — takes this brief as input, writes `docs/plans/blast-radius.md` in the repo's format
   (Context, tasks with AC, DAG, non-overlapping owned paths, skills, Done-condition commands).
2. **implementer** — one per task, only its owned paths; report includes command, exit code, fingerprint.
3. **test-writer** — tests for T2 (never touches production code; a bug is reported, not fixed).
4. **architecture-reviewer** (onion in `server/`, module boundaries in `client/`, no `@devdigest/shared` in `mcp/`)
   ∥ **plan-verifier** (MET / PARTIAL / NOT MET per AC).
5. Fixes for findings → re-run the implementer for the same task.
6. PR description includes an "agent → what it did" table.

## Tasks (input for planner)

### T1 — Response contract (zod) · skill: zod
Owned: `server/src/vendor/shared/contracts/brief.ts` **and** the identical copy
`client/src/vendor/shared/contracts/brief.ts` (+ export from both `index.ts` if needed).
- Add `BlastRadiusResponse = { pr_id, indexed_sha: string|null, index_status, degraded: boolean,
  reason: DegradedReason|null, blast: BlastRadius }`. Do not change `BlastRadius` itself.
- `indexed_sha` is needed for links: caller lines come from the index at `lastIndexedSha`, not the PR head.
- AC: both copies byte-identical (`diff` empty); `server/test/contracts.test.ts` extended.

### T2 — Server module `blast/` · skills: onion-architecture, fastify-best-practices, drizzle-orm-patterns, security
Owned: `server/src/modules/blast/{routes,service,repository,helpers,constants}.ts`,
registration in `server/src/modules/index.ts`, one line in `server/src/modules/repo-intel/service.ts` (see below),
`server/src/modules/pulls/routes.ts` (resolver).
- `repository.ts`: `pullExists` / list paths from `pr_files` — modelled on
  `server/src/modules/smart-diff/repository.ts` (`listFiles`).
- `service.ts`: workspace-scoped PR lookup (NotFoundError → 404) → changed files →
  **one** call to `container.repoIntel.getBlastRadius` + `getIndexState` (sha/status) →
  `helpers.toBlastRadius()` → `BlastRadiusResponse.parse(...)`. `req.log.info` with
  `{ index_status, changed_files, callers }` — evidence of reading the prebuilt index (P2).
- `helpers.ts` — pure mapping function:
  - group `callers` by `viaSymbol` → `downstream[]`; caller `{ name: symbol, file, line }`;
  - drop a caller whose `file` equals the symbol's declaring file (from `changedSymbols`) — defensive;
  - sort by `rank` desc, cap at `MAX_CALLERS_PER_SYMBOL` (imported from `repo-intel/constants.ts`, not hard-coded);
  - `endpoints_affected` / `crons_affected` — union of `factsByFile[callerFile]` over the group's files (crons separate);
    if `factsByFile` is absent (ripgrep degradation) — use `impactedEndpoints` only when there is a single group, else empty;
  - `downstream` sorted by the group's max rank; symbols without callers stay in `changed_symbols`;
  - `summary` — string built from counts: `"N symbols · M callers · K endpoints · J crons"`.
- `routes.ts`: `GET /pulls/:id/blast` (`IdParams`, `getContext`), template — `smart-diff/routes.ts`.
- `GET /pulls/resolve?repo=owner/name&pr=N` → `{ id }` in `pulls/routes.ts`, reusing the
  `resolvePullByRef` logic from `reviews/service.ts` / `PullsService.findOrSync` (no duplication) — for MCP.
- Found issue: `repo-intel/service.ts:386` does `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` on the **whole**
  list, not per symbol → replace with a per-symbol cap (one change; otherwise "20 per symbol" is unreachable).
- AC: `cd server && pnpm typecheck` + unit tests green; route returns a valid contract; no LLM call.

### T3 — Server tests (test-writer) · depends on T2
Owned: `server/src/modules/blast/helpers.test.ts`, `server/test/blast.it.test.ts`.
- Unit: grouping by `viaSymbol`; declaring file excluded; cap 20 via the constant; crons separate;
  fallback without `factsByFile`; `degraded`/`reason` pass through; summary.
- `.it`: route with a mock `repoIntel` via `ContainerOverrides` (template — `server/test/conventions.it.test.ts`),
  404 for a foreign/non-existent PR, `BlastRadiusResponse.parse` succeeds, `/pulls/resolve`.

### T4 — Client hook · skill: react-best-practices
Owned: `client/src/lib/hooks/blast.ts` (+ export in `hooks/index.ts`).
- `usePrBlast(prId)` → `api.get<BlastRadiusResponse>('/pulls/${prId}/blast')`, template — `hooks/intent.ts`.
- Resync — reuse the existing `useResyncRepoIntel` from `hooks/repo-intel.ts` (no new hook).

### T5 — Blast Radius block on Overview · skills: frontend-ui-architecture, react-best-practices, next-best-practices, react-testing-library · depends on T1, T4
Owned: `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/`
(`BlastRadiusCard.tsx`, `BlastTree.tsx`, `BlastGraph.tsx`, `helpers.ts`, `styles.ts`, `index.ts`, tests),
`_components/OverviewTab/OverviewTab.tsx`, `pulls/[number]/page.tsx` (pass `repoFullName`, `headSha`),
`client/messages/en/blast.json` (new keys).
- Stats row: symbols / callers / endpoints / crons (`stat.*` keys).
- Tree: symbol → callers `file:line` as `<a target="_blank" rel="noopener noreferrer">` to
  `githubBlobUrl(repoFullName, indexed_sha ?? headSha, file, line)` (`client/src/lib/github-urls.ts`) →
  endpoint chips, separate cron chips.
- Graph: `view.tree` / `view.graph` toggle; plain SVG in 3 columns (symbol → caller → endpoint/cron),
  coordinate layout is a pure function in `helpers.ts` (unit-tested). No new dependencies. Empty → `graph.empty`.
- States: loading, error, **no callers** → `noDownstream`, **degraded** → separate badge with the
  reason (`flag_off`/`index_failed`/`index_partial`/`repo_too_large`/`no_data`) + Resync button.
- All labels from `blast.json` via `next-intl` (like `prReview.json`); check how namespaces are loaded.
- AC: `cd client && pnpm test && pnpm typecheck`; tests: callers and links rendered (href with `#L<line>`),
  noDownstream, degraded badge, Tree/Graph switching.

### T6 — MCP `devdigest_get_blast_radius` · skills: zod, security · depends on T1 (shape), T2 (routes)
Owned: `mcp/src/tools/get-blast-radius{,.schema}.ts`, `mcp/src/api/{client,types}.ts`,
`mcp/src/format/blast.ts`, `mcp/test/tools-simple.test.ts` (blast block), `mcp/README.md`, `mcp/AGENTS.md`, one line in root `README.md`.
- `DevdigestApi` port: `resolvePull(repo, pr)` → `GET /pulls/resolve`, `getBlast(prId)` → `GET /pulls/:id/blast`.
- Zod-4 mirror of `BlastRadiusResponse` in `types.ts` (never import `@devdigest/shared`).
- Schema: `repo` and `pr` **required** (if missing — `toolError` with a hint).
- Description: short, when to call ("before reviewing a PR, to see which callers/endpoints/crons a change can affect").
- Response: compact markdown (summary, degraded note, symbol → callers `file:line` → endpoints/crons),
  through `capResponse`, file names `fence`d.
- Errors: `apiErrorToTool` (404 → "PR not found, check repo/pr"). Annotations: `readOnlyHint: true`, `idempotentHint: true`.
- AC: `cd mcp && npm test && npm run typecheck`; the "stub" test replaced with happy path / degraded / 404 / missing-args tests.

## DAG

T1 → {T2, T4, T6};  T2 → T3;  T4 → T5;  T2 → T6.  Owned paths do not overlap.

## Verification (orchestrator, after review)

1. Full run:
   `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run .it.test`,
   `cd client && pnpm test && pnpm typecheck`, `cd mcp && npm test && npm run typecheck`.
2. `./scripts/dev.sh`; `curl http://localhost:3001/repos/<repoId>/index-state` → `status: full`.
3. Test PR that changes an exported helper (e.g. from `server/src/modules/reviews/helpers.ts`
   or `client/src/components/diff-viewer/helpers.ts`) with ≥2 importers.
4. Browser preview: Overview → block, ≥2 callers + ≥1 endpoint, clicking `file:line` → GitHub at that line;
   Tree↔Graph; server log shows the index read.
5. Degraded: PR in a repo with `partial`/no index → badge with reason, Resync button.
6. Claude Code: "show blast radius for owner/repo#N" → `devdigest_get_blast_radius` → same map.
7. `pr-self-review` skill → PR in the fork; description: implementation, agent table, demo video (1–3 min, scenario 4→5→6).
