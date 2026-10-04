# Development Plan: Blast Radius (L04)

Input: `docs/plans/blast-radius-brief.md`. Scope: all P1 + P2 from the brief, plus one P3 item, the
**Tree / Graph toggle**. No LLM calls and no re-parsing: everything is served from
`container.repoIntel.getBlastRadius` + `getIndexState`.

## Requirements (IDs used by the tasks)

| ID | Requirement (from brief) |
|---|---|
| R1 | `BlastRadiusResponse` zod contract (server + client copy), `BlastRadius` itself unchanged |
| R2 | `GET /pulls/:id/blast`: workspace-scoped, maps `BlastResult` to `BlastRadius`, no LLM |
| R3 | Per-symbol caller cap in `repo-intel` (today the cap is global, see Discrepancy D1) |
| R4 | `GET /pulls/resolve?repo=&pr=` returns `{ id }` and reuses the by-ref resolver logic (for MCP) |
| R5 | P2 evidence: server log line `{ index_status, changed_files, callers }` per blast request |
| R6 | PR Overview "Blast Radius" block: stats, tree, GitHub links, loading/error/empty/degraded states, Resync |
| R7 | (P3) Tree / Graph toggle; graph is plain SVG, layout is a pure, unit-tested function |
| R8 | MCP `devdigest_get_blast_radius` works for real (replaces the stub) |
| R9 | Tests for R1–R8 |

## Context

- Modules touched:
  - `server/src/vendor/shared/contracts/` (+ the hand-maintained copy in `client/src/vendor/shared/contracts/`)
  - `server/src/modules/blast/` (new), `server/src/modules/index.ts`, `server/src/modules/repo-intel/service.ts` (one function),
    `server/src/modules/pulls/{routes,service}.ts`, `server/src/modules/reviews/service.ts` (delegation only)
  - `client/src/lib/hooks/`, `client/src/app/repos/[repoId]/pulls/[number]/`, `client/messages/en/blast.json`
  - `mcp/src/{api,tools,format}/`, `mcp/test/`, docs (`mcp/README.md`, `mcp/AGENTS.md`, root `README.md`)
- CLAUDE.md / INSIGHTS.md consulted: root `AGENTS.md`; `server/AGENTS.md` + `server/INSIGHTS.md`;
  `client/AGENTS.md` + `client/INSIGHTS.md`; `mcp/AGENTS.md` (`mcp/CLAUDE.md` is just `@AGENTS.md`) + `mcp/INSIGHTS.md`;
  `.claude/skills/pr-self-review/routing.md`.
- Architectural constraints:
  - **Onion (server):** `routes.ts` is transport only (params, `getContext`, call the service). `service.ts` orchestrates
    (repository + `container.repoIntel` facade) and calls `Contract.parse`. `helpers.ts` holds pure mapping with no I/O.
    `repository.ts` is the only file in `blast/` that touches `container.db`/Drizzle. Features import the `RepoIntel`
    facade/types (`repo-intel/types.ts`, `repo-intel/constants.ts`), never repo-intel internals (repository, pipeline).
  - Module files are named by role (`routes|service|repository|helpers|constants.ts`). Register a new module with one
    import + one entry in `server/src/modules/index.ts`.
  - Validation failures return **422**, not 400 (`server/src/app.ts:115-123`). A non-uuid `:id` returns 422.
  - The app logger is `false` under `NODE_ENV=test` (server INSIGHTS 2026-09-29). Any log line a test asserts on must
    go through an injectable logger interface on the service, not pino capture.
  - Null over zero (server INSIGHTS Decision 2026-09-20): "not computed" is `null`, never `''` or `0`.
    This applies to `indexed_sha` and `reason`.
  - `server/src/vendor/shared` and `client/src/vendor/shared` are hand-maintained duplicates that have **already
    diverged** (server INSIGHTS). Only mirror what this change needs. `contracts/brief.ts` is currently byte-identical on
    both sides and must stay that way. `review-refs.ts` exists **only** on the server side, by design (MCP-only contracts).
  - **Frontend:** route-scoped components go in `_components/<PascalCase>/` (`<Name>.tsx` + `helpers.ts`/`styles.ts`/
    `index.ts`/tests). Hooks: one file per domain in `client/src/lib/hooks/`, re-exported from `hooks/index.ts`.
    Labels go in `messages/en/<ns>.json`. `src/i18n/request.ts` auto-loads **every** `messages/en/*.json` as a namespace,
    so `blast.json` is already loaded as namespace `blast` and needs no registration. Tests wrap in
    `<NextIntlClientProvider locale="en" messages={{ blast: messages }}>` (pattern: `IntentCard.test.tsx`) and
    `vi.mock` the hooks module.
  - Client INSIGHTS: never trigger a side-effecting mutation (Resync) from an effect, only from a user action.
    `fireEvent.mouseEnter` does not fire React `onMouseEnter` (use `mouseOver`) if hover is tested.
  - **MCP:** thin HTTP wrapper. Never import `@devdigest/shared` (zod 4 here, zod 3 there); mirror in `src/api/types.ts`.
    Tools depend on the `DevdigestApi` port only. No `outputSchema`/`structuredContent`. Every response goes through
    `capResponse`. Untrusted text (file paths, symbol names, endpoints) goes through `fence`. stdout is the protocol:
    no `console.log`.

## Discrepancies between the brief and the code (verified)

- **D1 (confirmed):** `server/src/modules/repo-intel/service.ts:386` is `callers: callers.slice(0, MAX_CALLERS_PER_SYMBOL)`.
  It caps the **whole** rank-sorted list at 20, not 20 per symbol. The ripgrep fallback path (`getBlastRadius`
  lines 228-303) has **no** cap at all. T2 fixes the persistent path. The blast helper caps per symbol anyway, so the
  fallback path is covered downstream.
- **D2:** `DegradedReason` and the repo-intel `IndexStatus` union are **server-internal TS types**
  (`repo-intel/types.ts:25-32`), not zod contracts. The shared barrel already exports an unrelated `IndexStatus` (a zod
  object in `contracts/platform.ts:258`, the old clone/embedding status). T1 must therefore add **new** zod enums
  named `RepoIntelIndexStatus` and `RepoIntelDegradedReason`. Reusing `IndexStatus` or `DegradedReason` would cause a
  barrel export collision or confusion.
- **D3:** In practice `getBlastRadius` only ever returns `reason: 'no_data'`. Flag-off falls through to the ripgrep path,
  which hard-codes `no_data`, and a `partial` persistent index returns `degraded: false`. The UI badge reasons the brief
  lists (`flag_off`/`index_failed`/`index_partial`/`repo_too_large`) are unreachable on pure pass-through. T2 adds a
  pure `resolveDegradedReason` helper that refines the reason from `config.repoIntelEnabled` + `IndexState` (rules in T2).
- **D4:** The brief says the blast repository should model `pullExists`. That is insufficient: the service needs the
  PR's `repoId` to call the facade. The blast repository exposes `findPull(workspaceId, prId) → { id, repoId } | null`
  instead.
- **D5:** `resolvePullByRef` is a **private** method of `ReviewService` (`reviews/service.ts:154-175`). Reusing it
  "without duplication" means moving it to `PullsService` as a public `resolveByRef(...)` and having `ReviewService`
  delegate. So T2 also owns `pulls/service.ts` and `reviews/service.ts`, which the brief did not list.
- **D6:** `client/messages/en/blast.json` **already exists**, with keys `stat.{symbols,callers,endpoints,crons}`,
  `view.{tree,graph}`, `callerCount`, `noDownstream`, `graph.{empty,ariaLabel}`. T5 **extends** it and must not
  recreate or rename existing keys.
- **D7:** `brief.ts` is already re-exported from both `index.ts` barrels, so T1 needs no barrel edit.
  `review-refs.ts` is already exported from the server barrel.
- **D8:** Brief DAG says `T2 → T6`, but the brief's wave diagram runs T6 in parallel with T2 (W2). T6 only needs the
  route paths and the response shape, and both are pinned in this plan. So **T6 depends on T1 only** and runs in W2.
- **D9:** Skill routing. `drizzle-orm-patterns` is glob-mapped only to `server/src/db/**`, so it is **not** mandatory
  for `server/src/modules/blast/repository.ts`. It is listed below as advisory. The brief's
  `react-best-practices` for T4 does not match by glob either (`blast.ts` is not `.tsx`).
  `frontend-ui-architecture` (`client/src/**`) is what applies to T4.
- **D10:** `client/src/lib/hooks/repo-intel.ts` `useResyncRepoIntel` only invalidates `["repo-intel-state", repoId]`.
  It does **not** refresh the blast query. T5 handles this locally (refetch blast in the mutate `onSuccess`) and does
  not edit `repo-intel.ts`.
- **D11 (pre-existing, out of scope):** `mcp/src/api/client.ts` `messageFromBody` reads top-level `message`/`error`
  strings, but the server envelope is `{ error: { code, message } }`. As a result a 404 surfaces as `"HTTP 404"` plus
  the generic not-found hint. The tool hint is still actionable, so this is not fixed here (see Out of scope).

## Pinned interfaces (shared by T1/T2/T4/T5/T6, do not deviate)

```
// server/src/vendor/shared/contracts/brief.ts (and the identical client copy)
RepoIntelIndexStatus    = z.enum(['full','partial','degraded','failed'])
RepoIntelDegradedReason = z.enum(['flag_off','index_failed','index_partial','repo_too_large','no_data'])
BlastRadiusResponse = z.object({
  pr_id: z.string(),
  indexed_sha: z.string().nullable(),
  index_status: RepoIntelIndexStatus,
  degraded: z.boolean(),
  reason: RepoIntelDegradedReason.nullable(),
  blast: BlastRadius,           // existing schema, unchanged
})

// server/src/vendor/shared/contracts/review-refs.ts (server only)
ResolvedPullRef = z.object({ id: z.string() })

GET /pulls/:id/blast                   -> BlastRadiusResponse      (404 foreign/unknown PR, 422 non-uuid id)
GET /pulls/resolve?repo=<ref>&pr=<n>   -> ResolvedPullRef           (404 repo/PR not found, 409 ambiguous bare name, 422 bad query)
```

## Tasks

### Task T1: BlastRadiusResponse + ResolvedPullRef contracts
- Requirement-ID: R1, R4 (contract half)
- Depends-on: none
- Owned paths:
  - `server/src/vendor/shared/contracts/brief.ts`
  - `client/src/vendor/shared/contracts/brief.ts`
  - `server/src/vendor/shared/contracts/review-refs.ts`
  - `server/test/contracts.test.ts`
- Skills to apply:
  - `zod`: Mandatory (glob `server/src/vendor/shared/**`)
  - `frontend-ui-architecture`: Mandatory (glob `client/src/**`, for the client copy)
  - `engineering-insights`: Mandatory closing step
- Acceptance criteria:
  - `brief.ts` (server) exports `RepoIntelIndexStatus`, `RepoIntelDegradedReason`, `BlastRadiusResponse` and their
    inferred types, exactly as in "Pinned interfaces". The existing `BlastRadius`/`DownstreamImpact`/`BlastCaller`/
    `ChangedSymbol` schemas are unchanged: `git diff` shows only added lines for that file.
  - `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` prints nothing
    (exit 0).
  - `review-refs.ts` (server only) exports `ResolvedPullRef = z.object({ id: z.string() })` + type. No client copy is
    created.
  - No new name collides in the server barrel. `IndexStatus` and `DegradedReason` are **not** (re)declared.
  - `server/test/contracts.test.ts` gains cases that check all of the following:
    - a full `BlastRadiusResponse` fixture parses;
    - `indexed_sha: null` + `reason: null` parses;
    - an unknown `reason` (`'nope'`) fails;
    - an unknown `index_status` fails;
    - a missing `blast` fails;
    - `ResolvedPullRef.parse({ id: 'x' })` succeeds.
  - Neither `index.ts` barrel is modified.
- Done-condition:
  - `cd server && pnpm typecheck && pnpm exec vitest run test/contracts.test.ts`
  - `cd client && pnpm typecheck`
  - `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` (empty output)

### Task T2: Server `blast/` module, per-symbol cap, `/pulls/resolve`
- Requirement-ID: R2, R3, R4, R5
- Depends-on: [T1]
- Owned paths:
  - `server/src/modules/blast/routes.ts`
  - `server/src/modules/blast/service.ts`
  - `server/src/modules/blast/repository.ts`
  - `server/src/modules/blast/helpers.ts`
  - `server/src/modules/blast/constants.ts`
  - `server/src/modules/index.ts`
  - `server/src/modules/repo-intel/service.ts` (only the cap in `tryPersistentBlast` + one exported pure helper)
  - `server/src/modules/pulls/routes.ts`
  - `server/src/modules/pulls/service.ts`
  - `server/src/modules/reviews/service.ts` (only `resolvePullByRef` → delegation)
- Skills to apply:
  - `onion-architecture`: Mandatory (glob `server/src/modules/**`)
  - `fastify-best-practices`: Mandatory (glob `server/src/**/routes.ts`)
  - `security`: Always-on (new API endpoints, user-supplied query `repo`/`pr`, workspace scoping)
  - `drizzle-orm-patterns`: advisory only (not glob-matched, see D9; `blast/repository.ts` writes Drizzle queries)
  - `engineering-insights`: Mandatory closing step
- Acceptance criteria:
  - **repository.ts**: `BlastRepository(db)` with
    - `findPull(workspaceId, prId): Promise<{ id: string; repoId: string } | null>`, filtered by **both**
      `pullRequests.id` and `pullRequests.workspaceId`;
    - `listChangedPaths(prId): Promise<string[]>` from `pr_files`, ordered by path.
    It mirrors `smart-diff/repository.ts`. No other file in `blast/` imports `drizzle-orm` or `db/schema`.
  - **helpers.ts** is pure, with no imports from `platform/`, `db/` or `container`. It exports:
    - `toBlastRadius(result: BlastResult, opts?: { maxCallersPerSymbol?: number }): BlastRadius`:
      - groups `result.callers` by `viaSymbol` into `downstream[]`. Each caller is `{ name: c.symbol, file: c.file, line: c.line }`.
      - drops a caller whose `file` is a declaring file of a changed symbol with that same name
        (`changedSymbols.filter(s => s.name === viaSymbol).map(s => s.file)`).
      - within a group, sorts callers by `rank` desc and caps at `MAX_CALLERS_PER_SYMBOL`. The cap is **imported from
        `../repo-intel/constants.js`**; a literal `20` appears nowhere in `blast/`.
      - `endpoints_affected` / `crons_affected`: deduped union of `factsByFile[file].endpoints` / `.crons` over the
        group's caller files, kept in separate arrays. If `factsByFile` is undefined: `endpoints_affected =
        impactedEndpoints` only when there is exactly one group, otherwise `[]`. `crons_affected = []`.
      - `downstream` is sorted by the group's max caller rank desc, ties broken by symbol name asc for determinism.
        Groups that end up with 0 callers after filtering are omitted from `downstream`.
      - `changed_symbols` = all `result.changedSymbols` mapped to `{ name, file, kind }`, including symbols with no
        callers.
      - `summary` is exactly `` `${N} symbols · ${M} callers · ${K} endpoints · ${J} crons` ``:
        - N = `changed_symbols.length`
        - M = total callers across `downstream` after the cap
        - K = unique endpoints across groups
        - J = unique crons across groups
    - `resolveDegradedReason(result, state, flagEnabled): DegradedReason | null`:
      - returns `null` when `result.degraded !== true`;
      - otherwise returns the first match of:
        1. `!flagEnabled` → `'flag_off'`
        2. `state.degradedReason` if set
        3. `state.status === 'failed'` → `'index_failed'`
        4. `result.reason ?? 'no_data'`
  - **service.ts**: `BlastService` with `static fromContainer(container)` and an optional injected
    `log: { info(obj: object, msg?: string): void }` (default no-op). `getBlast(workspaceId, prId, log?)` does:
    1. `findPull` → `NotFoundError('Pull request not found')` when null (so a foreign PR gives the same 404 as a
       nonexistent one).
    2. `listChangedPaths`.
    3. **Exactly one** `container.repoIntel.getBlastRadius(repoId, paths)` call and one `getIndexState(repoId)` call
       (may be parallel).
    4. `BlastRadiusResponse.parse({ pr_id, indexed_sha, index_status: state.status, degraded: result.degraded === true,
       reason: resolveDegradedReason(...), blast: toBlastRadius(result) })`, where
       `indexed_sha = (!result.degraded && state.lastIndexedSha) ? state.lastIndexedSha : null` (never `''`).
    5. Exactly one `log.info({ index_status, changed_files, callers }, 'blast: served from repo-intel index')`, where
       `changed_files = paths.length` and `callers` = M from the summary.
    - No LLM provider, `codeIndex` or filesystem access in `blast/`. `grep -rn "llm\|codeIndex\|node:fs" server/src/modules/blast`
      returns nothing.
  - **routes.ts**: `GET /pulls/:id/blast` with `{ schema: { params: IdParams } }`, `getContext` for `workspaceId`,
    passes `req.log` to the service. The template is `smart-diff/routes.ts`. Registered in `modules/index.ts` as
    `blast` (one import + one entry).
  - **Per-symbol cap (R3)**: `repo-intel/service.ts` exports a pure
    `capCallersPerSymbol(callers: BlastCallerRow[], max: number): BlastCallerRow[]`. It keeps at most `max` rows per
    `viaSymbol`, preserves the input (rank-desc) order, and is used in `tryPersistentBlast` in place of
    `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`. No other line of `repo-intel/service.ts` changes. `RepoIntel` and
    `BlastResult` types are unchanged.
  - **Resolver (R4)**:
    - `PullsService.resolveByRef(workspaceId, repoRef, prNumber, log?)` holds the body moved verbatim from
      `ReviewService.resolvePullByRef`: `RepoService.resolve` → repo lookup → `findOrSync` → same 404 message. It
      returns `{ pull, repoFullName }`.
    - `ReviewService.resolvePullByRef` becomes a one-line delegation (or its call sites call `PullsService` directly).
      No copy of the logic remains in `reviews/`.
    - `pulls/routes.ts` adds `GET /pulls/resolve` with querystring
      `z.object({ repo: z.string().trim().min(1).max(200), pr: z.coerce.number().int().positive() })` and returns
      `ResolvedPullRef` `{ id }`.
    - Status codes: missing/invalid `pr` → 422, unknown repo → 404, ambiguous bare name → 409, unknown PR (no GitHub)
      → 404.
    - The existing `/pulls/:id` routes are unaffected (the static `resolve` segment wins over `:id` in find-my-way).
  - The pre-existing uncommitted edits in `pulls/routes.ts`, `reviews/service.ts` and `pulls/service.ts` are preserved:
    only additive or delegation edits, no reformatting.
  - Existing tests stay green, in particular `test/review-by-ref.it.test.ts`, `test/pulls-service.it.test.ts`,
    `test/repo-intel-facade-degraded.test.ts`, `test/conventions.it.test.ts`.
- Done-condition:
  - `cd server && pnpm typecheck`
  - `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`. The known Windows-only `test/indexer-pipeline.test.ts`
    ENOENT failures (server INSIGHTS 2026-09-20) are acceptable only if `git diff --stat` shows no change under
    `repo-intel/pipeline/**`.
  - `cd server && pnpm exec vitest run review-by-ref.it.test pulls-service.it.test conventions.it.test`. The output must
    show a non-zero executed test count, not "skipped" (server INSIGHTS on the Docker probe).

### Task T3: Server tests for blast + resolver + cap
- Requirement-ID: R9 (for R2–R5)
- Depends-on: [T2]
- Owned paths:
  - `server/src/modules/blast/helpers.test.ts`
  - `server/test/blast.it.test.ts`
  - `server/test/repo-intel-blast-cap.test.ts`
- Skills to apply:
  - `onion-architecture`: Mandatory (glob `server/src/modules/**`, for `helpers.test.ts`)
  - `security`: Always-on (asserts workspace-scoped 404 / input validation)
  - `engineering-insights`: Mandatory closing step
  - (`server/test/*` files match no routing glob; they are covered by the general pass only)
- Acceptance criteria:
  - `helpers.test.ts` has one `it` per behaviour, all green:
    1. callers are grouped by `viaSymbol`, giving the correct `downstream[].symbol` set;
    2. a caller in the symbol's declaring file is excluded;
    3. given 25 callers for one symbol, exactly `MAX_CALLERS_PER_SYMBOL` survive and they are the highest-rank ones.
       The test imports the constant and does not hard-code 20;
    4. crons land in `crons_affected` and not in `endpoints_affected`;
    5. without `factsByFile`: a single group gets `impactedEndpoints`, while 2+ groups get `[]`;
    6. `downstream` is ordered by max rank;
    7. a symbol without callers is present in `changed_symbols` and absent from `downstream`;
    8. `summary` string equals the exact expected text;
    9. `resolveDegradedReason` covers the cases `degraded:false → null`, flag off → `flag_off`,
       `state.degradedReason` passthrough, `failed → index_failed`, and fallback → `no_data`.
  - `repo-intel-blast-cap.test.ts` tests `capCallersPerSymbol` with 2 symbols × 25 rows: the result has 20 + 20 rows
    and the order is preserved. This is a unit test with no DB, which is why it is not named `.it`.
  - `blast.it.test.ts` uses `buildApp({ config, overrides: { repoIntel: mock } })` (template:
    `test/conventions.it.test.ts`) with a seeded workspace/repo/PR/`pr_files`, and checks:
    - `GET /pulls/:id/blast` returns 200 and `BlastRadiusResponse.parse(body)` succeeds;
    - the mock's `getBlastRadius` was called **once** with the PR's `repoId` and the seeded paths;
    - a PR id from another workspace → 404;
    - a random uuid → 404;
    - `not-a-uuid` → 422;
    - a degraded mock (`degraded:true`) → `degraded: true`, `indexed_sha: null`, non-null `reason`;
    - the injected service logger received `{ index_status, changed_files, callers }`. Do not rely on pino, which is
      disabled in test;
    - `GET /pulls/resolve?repo=<owner/name>&pr=<n>` → 200 `{ id }` matching the seeded PR;
    - unknown repo → 404;
    - missing `pr` → 422.
  - No production file is modified. A genuine production bug is reported in the task report, not fixed.
- Done-condition:
  - `cd server && pnpm exec vitest run src/modules/blast/helpers.test.ts test/repo-intel-blast-cap.test.ts`
  - `cd server && pnpm exec vitest run blast.it.test`, with a non-zero executed count in the output (not skipped)
  - `cd server && pnpm typecheck`

### Task T4: Client hook `usePrBlast`
- Requirement-ID: R6 (data layer)
- Depends-on: [T1]
- Owned paths:
  - `client/src/lib/hooks/blast.ts`
  - `client/src/lib/hooks/blast.test.ts`
  - `client/src/lib/hooks/index.ts`
- Skills to apply:
  - `frontend-ui-architecture`: Mandatory (glob `client/src/**`)
  - `react-testing-library`: Mandatory (glob `client/**/*.test.ts`)
  - `engineering-insights`: Mandatory closing step
- Acceptance criteria:
  - `blast.ts` is `"use client"` and exports `blastKey(prId)` (`["pr-blast", prId] as const`) and `usePrBlast(prId)`.
    `usePrBlast` is `useQuery({ queryKey: blastKey(prId), queryFn: () => api.get<BlastRadiusResponse>(\`/pulls/${prId}/blast\`), enabled: !!prId })`
    and mirrors `hooks/intent.ts`. The type is imported from `@devdigest/shared`.
  - No new resync hook. `useResyncRepoIntel` from `hooks/repo-intel.ts` is reused by T5, and `repo-intel.ts` is not
    edited.
  - `hooks/index.ts` gains exactly one line, `export * from "./blast";`.
  - `blast.test.ts` (pattern: `hooks/intent.test.ts`) checks that the hook calls `api.get` with `/pulls/pr1/blast` and
    does not fetch when `prId` is null or undefined.
- Done-condition: `cd client && pnpm test -- src/lib/hooks/blast.test.ts && pnpm typecheck`

### Task T5: Blast Radius block on the PR Overview tab (Tree + Graph)
- Requirement-ID: R6, R7
- Depends-on: [T1, T4]
- Owned paths:
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/**`, which contains:
    - `BlastRadiusCard.tsx`, `BlastTree.tsx`, `BlastGraph.tsx`
    - `helpers.ts`, `styles.ts`, `index.ts`
    - `BlastRadiusCard.test.tsx`, `helpers.test.ts`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  - `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
  - `client/messages/en/blast.json`
- Skills to apply:
  - `frontend-ui-architecture`: Mandatory (glob `client/src/**`)
  - `react-best-practices`: Mandatory (glob `client/**/*.tsx`)
  - `next-best-practices`: Mandatory (glob `client/src/app/**`)
  - `react-testing-library`: Mandatory (glob `client/**/*.test.tsx`, `*.test.ts`)
  - `security`: Always-on (external links built from repo data: `target="_blank"` needs
    `rel="noopener noreferrer"`, and file paths are URL-encoded via `githubBlobUrl`)
  - `engineering-insights`: Mandatory closing step
  - (`client/messages/**` matches no routing glob; it is covered by the general pass)
- Acceptance criteria:
  - `OverviewTab` gains the props `repoId: string`, `repoFullName: string | null` and `headSha: string`, and renders
    `<BlastRadiusCard prId repoId repoFullName headSha />` directly after `<IntentCard />`. `page.tsx` passes
    `repoId`, `repoFullName` (already computed at line 86) and `pr.head_sha`. No other change to `page.tsx`.
  - **Stats row**: four values labelled via `blast.stat.symbols|callers|endpoints|crons`. The numbers are:
    - `changed_symbols.length`;
    - total callers;
    - unique endpoints;
    - unique crons.
  - **Tree** (default view):
    - each `downstream[]` symbol is listed with its callers as `file:line`;
    - when `repoFullName` is non-null, each caller is an `<a>` with `target="_blank"`, `rel="noopener noreferrer"` and
      `href = githubBlobUrl(repoFullName, indexed_sha ?? headSha, file, line)`, so the href ends with `#L<line>`;
    - when `repoFullName` is null, callers are plain text with no `<a>`;
    - endpoint chips and cron chips render as visually separate groups.
  - **Graph**:
    - a toggle labelled `blast.view.tree` / `blast.view.graph` switches views. It uses buttons with `aria-pressed`
      (or the existing ui-kit segmented control, if one exists);
    - the graph is plain `<svg role="img" aria-label={t("graph.ariaLabel")}>` in 3 columns: symbol → caller →
      endpoint/cron;
    - coordinates come from a pure `layoutBlastGraph(blast): { nodes: {id, kind, label, x, y}[]; edges: {from, to}[]; width; height }`
      in `helpers.ts`;
    - an empty `downstream` shows `blast.graph.empty` instead of an svg;
    - no new npm dependencies: `git diff client/package.json` is empty.
  - **States**:
    - loading: skeleton or spinner;
    - error: message plus the query's `refetch`;
    - `downstream.length === 0 && !degraded` → `blast.noDownstream` with `{count: changed_symbols.length}`;
    - `degraded === true` → a separate badge showing the human label for `reason`, using new keys
      `blast.degraded.title` and `blast.reason.{flag_off,index_failed,index_partial,repo_too_large,no_data}`, plus a
      Resync button (`blast.resync`). The button calls `useResyncRepoIntel(repoId).mutate(undefined, { onSuccess: () => refetch() })`
      and is triggered by click only, never from an effect.
  - Every user-visible string comes from `useTranslations("blast")`, with no hard-coded English in TSX. New keys are
    **added** to the existing `blast.json`. Existing keys (`stat.*`, `view.*`, `callerCount`, `noDownstream`,
    `graph.*`) are kept unchanged.
  - **Tests**:
    - `helpers.test.ts` checks that `layoutBlastGraph` puts nodes in 3 x-columns, that symbol→caller and
      caller→endpoint/cron edges exist, that the output is deterministic (same input gives a deep-equal result), and
      that empty input gives `nodes: []`.
    - `BlastRadiusCard.test.tsx` (mocks `lib/hooks/blast` and `lib/hooks/repo-intel`, wraps in
      `NextIntlClientProvider` with `{ blast: messages }`) checks:
      - callers are rendered and a link `href` contains `#L<line>` and uses `indexed_sha` when present;
      - `headSha` is used when `indexed_sha` is null;
      - the `noDownstream` text renders;
      - the degraded badge shows the reason label and clicking Resync calls `mutate`;
      - clicking the graph toggle shows the svg (role `img`) and clicking tree shows the links again.
  - There is no `OverviewTab` test today. Adding one is optional and stays inside owned paths if added.
- Done-condition: `cd client && pnpm test && pnpm typecheck`

### Task T6: MCP `devdigest_get_blast_radius` (real implementation)
- Requirement-ID: R8, R9 (MCP part)
- Depends-on: [T1] (shape). The route paths are pinned above, so the code does not need T2 (see D8). Live manual
  verification needs T2 merged.
- Owned paths:
  - `mcp/src/tools/get-blast-radius.ts`
  - `mcp/src/tools/get-blast-radius.schema.ts`
  - `mcp/src/api/client.ts`
  - `mcp/src/api/types.ts`
  - `mcp/src/format/blast.ts`
  - `mcp/test/tools-simple.test.ts` (only the `devdigest_get_blast_radius` describe block)
  - `mcp/test/client.test.ts` (new cases only)
  - `mcp/README.md`, `mcp/AGENTS.md`
  - root `README.md` (only the line mentioning `devdigest_get_blast_radius` (stub), currently ~line 143)
- Skills to apply:
  - `zod`: Mandatory (glob `**/*.schema.ts`)
  - `security`: Always-on (untrusted repo data in tool output, so it must be fenced; user input goes into URLs, so it
    must be encoded)
  - `engineering-insights`: Mandatory closing step
  - (other `mcp/**` files match no routing glob; they are covered by the general pass)
- Acceptance criteria:
  - The `DevdigestApi` port gains:
    - `resolvePull(repo, pr, opts?) → ResolvedPullRef`, implemented as `GET /pulls/resolve?repo=..&pr=..` via `qs()`;
    - `getBlast(prId, opts?) → BlastRadiusResponse`, implemented as `GET /pulls/${encodeURIComponent(prId)}/blast`.
  - `types.ts` adds zod-4 lenient mirrors `ResolvedPullRef` and `BlastRadiusResponse` (incl. nested `blast`). The
    `reason`/`index_status` fields are mirrored as `z.string().nullable()` / `z.string()` so a future enum value cannot
    turn into `invalid_response`. `grep -rn "@devdigest/shared" mcp/src` returns nothing.
  - Schema:
    - `repo` and `pr` are described as **required** (`pr` keeps `z.coerce.number().int().positive()`);
    - they stay `.optional()` at the zod level so the handler can return a `toolError` with a next-step hint ("Provide
      both repo (owner/name) and pr (number)") instead of an SDK validation error. This matches the `get-findings`
      pattern (see Open questions).
  - Description is short English, saying when to call the tool: "Before reviewing a PR, see which callers, endpoints
    and crons its changes can affect (from the prebuilt repo index)." No "STUB" wording remains anywhere
    (`grep -rn "STUB\|not_implemented" mcp/src mcp/test` returns nothing).
  - Handler: `resolvePull` → `getBlast` → `toolText(capResponse(formatBlast(resp, { repo, pr })))`. The signal is
    passed as `ctx.mcpReq.signal`. Errors go through `apiErrorToTool(err, { apiUrl, action: 'reading the blast radius' })`.
    Annotations: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`. The title is
    no longer "(stub)".
  - `format/blast.ts` `formatBlast` produces compact markdown:
    - a heading `repo#pr`;
    - the `summary` line;
    - if `degraded`, a note `Index degraded (<reason>) — results may be incomplete; resync the repo in DevDigest.`;
    - per `downstream` symbol, its callers as `file:line`, then endpoints and crons;
    - symbol names, file paths, endpoints and crons are emitted through `fence` (or the same inline-safe truncation
      helper used by `format/findings.ts`);
    - if `downstream` is empty, a line saying no downstream callers were found for N changed symbols.
  - `tools-simple.test.ts`: the stub test is **replaced** by the following tests:
    - happy path (fake `resolvePull` + `getBlast`; the text contains the summary, a `file:line` and an endpoint;
      `isError` is falsy);
    - degraded (the text contains the degraded note and the reason);
    - 404 (`resolvePull` rejects with `ApiError('not_found', …)`; `isError` is true and the text contains "Check the repo");
    - missing args (each of: no args, only `repo`, only `pr` gives `isError` true with the hint, and no API call is made).
  - `client.test.ts`: `resolvePull` encodes `repo`/`pr` into the query, and `getBlast` encodes the path segment and
    parses the mirror.
  - Docs: `mcp/README.md` tools table row and `mcp/AGENTS.md` role line no longer say "stub". The root `README.md`
    line drops "(stub)".
- Done-condition: `cd mcp && npm test && npm run typecheck`

## DAG and waves

```
T1 ──► T2 ──► T3
 ├───► T4 ──► T5
 └───► T6
```

- **W1:** T1
- **W2 (parallel):** T2 ∥ T4 ∥ T6. Their owned paths are disjoint: `server/src/modules/**` vs `client/src/lib/hooks/**`
  vs `mcp/**` + `README.md`.
- **W3 (parallel):** T3 (test-writer) ∥ T5. Their owned paths are disjoint: `server/**` tests vs
  `client/src/app/**` + `client/messages/en/blast.json`.
- Overlap check: no path appears in two tasks. `server/test/contracts.test.ts` belongs to T1 only. The root
  `README.md` belongs to T6 only. No task owns `server/src/db/migrations/**` or any lock file. No migration is needed:
  everything is read from existing tables.

## Out of scope / deferred

- P3 items other than the Tree/Graph toggle.
- Adding a cap or `factsByFile` to the ripgrep fallback path of `getBlastRadius`. Only the persistent-path cap is
  fixed; the helper caps downstream.
- Fixing `mcp` `messageFromBody` to read the nested `{ error: { message } }` envelope (D11).
- An e2e (`e2e/`) scenario for the block. Verification is manual per brief §Verification.
- Syncing other divergences between `server/src/vendor/shared` and `client/src/vendor/shared`.
- Showing the blast in the review prompt or `PrBrief` composition.
- `doc-writer` output under `docs/features/blast-radius/` (optional, after merge).

## Open questions

- **MCP required args (T6):** The brief asks for both "required" and "toolError with a hint if missing". This plan
  resolves it as optional at the zod level, described as required, with the handler returning the hint. If the
  orchestrator wants SDK-level required validation instead, the missing-args test must assert the SDK error instead.
- **`indexed_sha` on the degraded path (T2):** The plan sets it to `null` whenever `degraded`, because the ripgrep
  fallback reads the clone's working tree rather than `lastIndexedSha`, so the UI links to `headSha`. Neither SHA is
  guaranteed to match the fallback's line numbers. Confirm this is acceptable.
- **`index_partial`:** `tryPersistentBlast` serves `partial` indexes as `degraded: false`. The plan surfaces the state
  only via `index_status: 'partial'`, with no badge. Should T5 show a soft "partial index" hint when
  `index_status === 'partial'`? The plan does not require it.
- **Graph toggle control:** Check whether `@devdigest/ui` has a segmented control or tabs primitive before building
  buttons (T5 implementer decides; either satisfies the AC).

## Red flags

- `pulls/routes.ts`, `pulls/service.ts`, `reviews/service.ts` and the server `index.ts` already carry **uncommitted
  changes** on branch `lesson_04` (the MCP work). T2 must edit on top of them and must not revert or reformat them.
  Check with `git diff` before and after.
- Route ordering: `GET /pulls/resolve` must not be shadowed by `GET /pulls/:id` (`IdParams` is a uuid, so a shadow would
  show up as 422). find-my-way prefers static segments, but T3 must assert 200.
- Moving `resolvePullByRef` (D5) changes `ReviewService` behaviour if done carelessly. The 404 message text is asserted
  by `review-by-ref.it.test.ts` and by the MCP hint flow, so keep it byte-identical.
- `capCallersPerSymbol` changes how many callers `getBlastRadius` returns (it can now return more than 20 in total).
  Any other consumer of `BlastResult.callers` must tolerate this. Today the only consumers are blast (new) and tests.
  Grep `getBlastRadius` before merging.
- Integration tests can **skip silently and report green** on Windows when the 5s Docker probe times out. Every `.it`
  Done-condition requires a visible non-zero executed count.
- `client/messages/en/blast.json` already exists (D6). Recreating it would drop keys silently. Extend only.
- Caller `file`, symbol and endpoint strings come from the indexed repo and are untrusted. They must be rendered as
  React text (no `dangerouslySetInnerHTML`) in T5 and `fence`d in T6. `href`s go only through `githubBlobUrl`.
- Resync is async (202). Refetching blast right after `onSuccess` will usually still show the old (degraded) result.
  That is acceptable for this scope; do not add polling from an effect.
- Never hard-code `20`. Both the helper and the tests import `MAX_CALLERS_PER_SYMBOL`.
