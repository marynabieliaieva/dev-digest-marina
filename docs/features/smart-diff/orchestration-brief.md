# Smart Diff — orchestration brief

Input for `planner` (and context for `implementer` / `plan-verifier` /
`architecture-reviewer`). Requirements: [assignment.md](assignment.md).
The Development Plan itself is written by `planner` to `docs/plans/smart-diff.md`.

Goal: run the pipeline with **minimal token spend without losing quality** —
one planner call with a ready fact sheet (no re-exploration), 3 implementer
tasks instead of 6–9, parallel branches, a single reviewer pass at the end,
fixes via `SendMessage` to the same agent instead of new spawns.

Branch: `lesson_03` (work directly on it; no separate feature branch).

## What already exists (verified — planner need not search for it)

| What | Where |
|---|---|
| `SmartDiff` / `SmartDiffGroup` / `SmartDiffFile` contract, `SmartDiffRole = enum(core,wiring,boilerplate)` | `server/src/vendor/shared/contracts/brief.ts:116-149` + identical copy `client/src/vendor/shared/contracts/brief.ts` (manual sync) |
| `SmartDiffResponse = SmartDiff` | `…/contracts/review-api.ts:85-87` (both copies) |
| Contract test | `server/test/contracts.test.ts:118` |
| Thin-module template (routes → service, `getContext`, `IdParams`) | `server/src/modules/intent/routes.ts` |
| PR files / review findings | `server/src/modules/reviews/{diff-loader.ts,repository/pull.repo.ts,repository/review.repo.ts}`; `GET /pulls/:id/reviews` in `reviews/routes.ts:129` |
| Module registration | `server/src/modules/index.ts` |
| Diff tab | `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (already has Show/Hide comments toggle); `…/[number]/page.tsx` already calls `usePrReviews(prId)` (line 40) |
| Generic diff viewer | `client/src/components/diff-viewer/{DiffViewer,FileCard,CodeLine}/`, `helpers.ts` (`parsePatch`, `oldNo/newNo`), `comments.ts` (`keysForLine`, `partitionThreads`, `DiffCommentApi`), `constants.ts` (`AUTO_EXPAND_MAX_LINES`), `OutdatedComments/` |
| Finding card | `…/[number]/_components/FindingCard/FindingCard.tsx` (+ `constants.ts` `SEV_COLOR`) |
| Hooks | `client/src/lib/hooks/reviews.ts`: `usePrReviews` (:51), `useFindingAction` (:139) |
| Severity colours | `client/src/vendor/ui/primitives/{tokens.ts SEV, Badge.tsx SeverityBadge}` |
| i18n | `client/messages/en/prReview.json` → `smartDiff` (has core/wiring/boilerplate labels, `filesCount`, `findingLines`, `groupedByRole`) |

## Design decisions (planner must carry these into the plan)

1. **Classifier** — new module `server/src/modules/smart-diff/`: `constants.ts`
   (ordered `ROLE_RULES` array + `ROLE_ORDER`), `helpers.ts` → pure
   `classifyFile(path): SmartDiffRole` (no Fastify/DB imports — becomes a
   pre-prompt filter in L08). Patterns as regexes in `constants.ts`, **no new
   npm dependencies** (lock files are off-limits). Rule order: boilerplate →
   tests → wiring → docs → core.
2. **Test table first** — `helpers.test.ts` "path → role", including the 3
   disputed cases: `__tests__/__snapshots__/x.snap → boilerplate`,
   `.claude/skills/security/SKILL.md → wiring`, `e2e/README.md → tests`.
3. **Contract** — `SmartDiffRole` → 5 values in **both** `brief.ts` copies
   (must stay byte-identical); extend `contracts.test.ts`.
4. **Route** `GET /pulls/:id/smart-diff` (routes → service → existing
   reviews/pull repositories; zero calls to any LLM adapter). Always returns all
   5 groups in `ROLE_ORDER` (empty ones with `files: []`, so P1 "five groups"
   holds on any PR). `finding_lines` = `start_line` of findings from the same
   review set that `GET /pulls/:id/reviews` exposes (planner checks the
   "latest review" semantics so server counters and client inline cards never
   disagree). `split_suggestion = { too_big: false, total_lines: Σ(additions+deletions), proposed_splits: [] }`.
   Response validated by `SmartDiffResponse`.
5. **Generic ↔ route boundary** — `components/diff-viewer` must **not** import
   `FindingCard` from the route folder. Add a prop modelled on `DiffCommentApi`:
   `findings?: DiffFindingApi { byPath: Map<string, Finding[]>; show: boolean; renderFinding(f): ReactNode }`.
   `DiffTab` passes `FindingCard` (or a compact copy) as `renderFinding`.
6. **UI** — groups rendered by a route-scoped component (`_components/SmartDiffGroup/`);
   Smart/Original toggle is local state in `DiffTab`, Original = current
   `DiffViewer` unchanged. Hiding findings reuses the GitHub-comments toggle (P2).
   After Run review, invalidate the smart-diff query together with reviews (P3).
   All labels from `prReview.json` → `smartDiff` (+ `testsLabel`, `docsLabel`,
   `smartOrder`, `originalOrder`, `noReviewYet`, role descriptions).
7. **Finding outside the patch** → separate block at the end of the file (like
   `OutdatedComments`), never dropped.

## Task breakdown hint (DAG)

| Task | Scope | Owned paths | Depends on | Skills (per `pr-self-review/routing.md`) |
|---|---|---|---|---|
| **T1 server** | Contract (5 roles, both copies) + `smart-diff` module: constants, `classifyFile`, test table, service, route, registration, unit test of service/route with mocks | `server/src/modules/smart-diff/**`, `server/src/modules/index.ts`, `{server,client}/src/vendor/shared/contracts/brief.ts`, `server/test/contracts.test.ts` | — | onion-architecture, fastify-best-practices, zod, security |
| **T2 diff-viewer findings** | `DiffFindingApi`; dot on `FileCard`; finding under line via `keysForLine` (`RIGHT:${start_line}`); coloured stripe + severity label on `CodeLine`; out-of-patch block; collapse finding to one line (P3); RTL test | `client/src/components/diff-viewer/**` | — (API fixed in the plan) | frontend-ui-architecture, react-best-practices, react-testing-library |
| **T3 Smart Diff UI** | `useSmartDiff` in `hooks/reviews.ts` + invalidation after run; i18n keys; groups in `DiffTab` (role header, `N files`, `● N`, sticky, collapsed docs/boilerplate, empty state), Smart/Original toggle, wire `DiffFindingApi` with `FindingCard` + `useFindingAction`; RTL test | `…/pulls/[number]/_components/DiffTab/**`, new `…/_components/SmartDiffGroup/**`, `client/src/lib/hooks/reviews.ts`, `client/messages/en/prReview.json`, `…/[number]/page.tsx` (only if a prop is needed) | T1, T2 | frontend-ui-architecture, react-best-practices, next-best-practices, react-testing-library |

T1 ∥ T2 run in parallel; T3 after both. No separate `test-writer` — tests are
part of each task's Done-condition. `doc-writer` skipped (not required).

## Execution order (orchestrator = main session)

1. **planner** (opus, one call). Input: this file + `assignment.md`. Hard
   limits: *do not call researcher, do not re-read the listed files in full,
   plan ≤ ~300 lines, 3 tasks, every AC checkable (command / grep / test).*
   Output: `docs/plans/smart-diff.md`. Orchestrator sanity-checks it (owned
   paths disjoint, every P1/P2 criterion covered by an AC).
2. **implementer T1** ∥ **implementer T2** (sonnet, background). Minimal prompt:
   "plan `docs/plans/smart-diff.md`, task Tn; read only Context/Design and your
   task section." Commit after each green report.
3. **implementer T3** (sonnet) after T1 + T2.
4. **architecture-reviewer ∥ plan-verifier** — in parallel, **once** over the
   whole feature diff (not per task). plan-verifier accepts Execution Report
   command blocks by fingerprint instead of re-running.
5. Any NOT MET / boundary violation → `SendMessage` to the same implementer
   (context kept), then re-check only the affected criteria.
6. Orchestrator: one full test/typecheck run (below), then the `pr-self-review`
   skill (the only merge gate); `engineering-insights` if something non-obvious came up.
7. Manual browser check per "How to verify", PR description (what each
   subagent did + plan-verifier result). The user records the video.

## Token-saving summary

- Assignment extracted once → `assignment.md`; nobody parses the PDF again.
- planner gets ready facts/paths → no researcher, no broad exploration.
- 3 tasks instead of 6–9 (each spawn re-reads CLAUDE.md/INSIGHTS/skills).
- implementers read only their plan section; tests inside tasks, no test-writer.
- Reviewers run once, in parallel; verifier trusts fingerprinted blocks.
- Fixes via `SendMessage`, not new agents; doc-writer skipped.
- Quality kept: opus for planning and architecture review, TDD test table for
  the classifier, `pr-self-review` as the final gate.

## Verification

```sh
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck
cd client && pnpm test && pnpm typecheck
cd reviewer-core && npm test && npm run typecheck
diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts   # must be empty
```

Manual scenario (stack via `./scripts/dev.sh`): test PR in the fork with a new
dependency (`pnpm-lock.yaml`), a change in `server/src/…`, a test, a
config/barrel file and a `.md` file →

1. Files changed: 5 groups in order `core→tests→wiring→docs→boilerplate` with
   labels and counters; docs/boilerplate collapsed; lock file in boilerplate.
2. Run review (strong model) → without reload: `● N` on the group header, dot on the file card.
3. Expand file → finding card under the right line + stripe/label; Accept/Dismiss
   change state; the toggle hides findings.
4. Original order → GitHub order, and back.
5. Server logs show no model call when opening the tab.
