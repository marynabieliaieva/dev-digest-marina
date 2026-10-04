# Development Plan: Smart Diff (files grouped by role + review findings inline in the diff)

Sources of truth: `docs/features/smart-diff/assignment.md` (requirements, P1/P2/P3) and
`docs/features/smart-diff/orchestration-brief.md` (verified fact sheet + design decisions).
Implementers: read **Context**, **Shared contracts** and your own task section only.

## Context
- Modules touched:
  - `server/src/modules/smart-diff/` (new), `server/src/modules/index.ts` (registration)
  - `server/src/vendor/shared/contracts/brief.ts` + `client/src/vendor/shared/contracts/brief.ts` (contract)
  - `client/src/components/diff-viewer/**` (generic viewer)
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/{DiffTab,SmartDiffGroup}/`, `…/[number]/page.tsx`
  - `client/src/lib/hooks/reviews.ts`, `client/messages/en/prReview.json`
- CLAUDE.md / INSIGHTS.md consulted: root `AGENTS.md`, `server/CLAUDE.md`, `server/INSIGHTS.md`,
  `client/CLAUDE.md`, `client/INSIGHTS.md`, `.claude/skills/pr-self-review/routing.md`. Relevant entries:
  - server INSIGHTS: the two `vendor/shared` copies have ALREADY diverged elsewhere — mirror only the
    `SmartDiffRole` change, do not "sync" other symbols; the `SmartDiff` block (lines 116-149) must be identical.
  - server INSIGHTS: non-uuid `:id` returns **422** (not 400); app logger is `false` under `NODE_ENV=test`.
  - server INSIGHTS: "not yet computed" aggregates are `null`, not zero (relevant to the empty state).
  - server INSIGHTS: `test/indexer-pipeline.test.ts` has 6 pre-existing Windows ENOENT failures — not yours.
  - client INSIGHTS: optional handler props silently drop affordances — grep every `<FileCard`/`<DiffViewer`
    call site after adding the `findings` prop. Use `fireEvent.mouseOver` not `mouseEnter` in RTL.
- Architectural constraints:
  - onion-architecture: `smart-diff` is a thin module `routes.ts → service.ts → repository.ts`; `helpers.ts`
    and `constants.ts` are pure (no Fastify, no Drizzle, no container imports) so `classifyFile` can be
    imported by the L08 prompt-filter without an HTTP request. The service receives **no LLM adapter**.
  - Route template: `server/src/modules/intent/routes.ts` (`getContext(container, req)`, `IdParams`,
    workspace-scoped lookup → `NotFoundError`).
  - frontend-ui-architecture: `client/src/components/diff-viewer` is generic and must **not** import anything
    from `client/src/app/**` (in particular not `FindingCard`). Route-specific rendering is injected through a
    render-prop (`DiffFindingApi.renderFinding`), exactly like `DiffCommentApi`.
  - Severity colour/word only from `client/src/vendor/ui/primitives` (`SEV`, `SeverityBadge`) — no new palette.
  - No new npm dependencies (lock files are off-limits) — patterns are hand-written regexes.

### Shared contracts (fixed here so T1 ∥ T2 ∥ T3 can work independently)

1. `SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate'])` in both `brief.ts` copies.
2. `GET /pulls/:id/smart-diff` → `SmartDiffResponse` (= `SmartDiff`):
   - `groups` always has exactly 5 entries in `ROLE_ORDER = ['core','tests','wiring','docs','boilerplate']`
     (empty groups have `files: []`); files inside a group keep the stored PR file order.
   - `finding_lines`: sorted, de-duplicated `start_line`s of the **selected findings** for that path.
   - `split_suggestion = { too_big: false, total_lines: Σ(additions + deletions), proposed_splits: [] }`.
3. **"Selected findings" rule** (same rule on server and client so `● N` and inline cards never disagree).
   `GET /pulls/:id/reviews` returns *every* review of the PR, newest first, and one Run review can produce
   one review per agent. So: take reviews with `kind === 'review'`, keep the **newest review per `agent_id`**
   (`null` agent_id counts as one bucket), and use all of their findings. Dismissed findings are still
   included (the card shows their state). Server: `selectLatestReviews` in `smart-diff/helpers.ts`.
   Client: `selectLatestFindings(reviews: ReviewRecord[]): FindingRecord[]` in `DiffTab/helpers.ts`.
4. `DiffFindingApi`: new file `client/src/components/diff-viewer/findings.ts`, exported from the viewer's
   public entry (whatever `index.ts` / file `DiffViewer` is imported from today):
   ```ts
   export type DiffFindingSeverity = "CRITICAL" | "WARNING" | "SUGGESTION";
   /** Structural subset of FindingRecord — a FindingRecord is assignable to it. */
   export interface DiffFinding {
     id: string; file: string; start_line: number; end_line: number;
     severity: DiffFindingSeverity; title: string;
   }
   export interface DiffFindingApi {
     byPath: ReadonlyMap<string, DiffFinding[]>; // key = PrFile.path
     show: boolean;                                // false → no inline cards / stripes / labels
     renderFinding: (f: DiffFinding) => React.ReactNode; // T3 looks the full record up by f.id
   }
   ```
   `DiffViewer` and `FileCard` take `findings?: DiffFindingApi` (optional → existing call sites unchanged).
   Line anchor key: `RIGHT:${start_line}` (compatible with `keysForLine`). Line label words:
   `CRITICAL → blocker`, `WARNING → warning`, `SUGGESTION → suggestion`.
5. Test ids (used by T2 tests and T3 tests): `file-finding-dot`, `finding-line-label`, `diff-finding-inline`,
   `diff-findings-outside`, `smart-diff-group-<role>`, `smart-diff-group-findings`. Finding-marked code lines
   carry `data-finding-severity="<SEVERITY>"`.

## Tasks

### Task T1: Server — 5-role contract, classifier, `GET /pulls/:id/smart-diff`
- Requirement-ID: P1 (five groups, lock file → boilerplate, group counter data); P2 (constants file + table
  test incl. 3 disputed cases, contract validation, enum in both copies, no model call, works before first review)
- Depends-on: none
- Owned paths:
  - `server/src/modules/smart-diff/**` (new: `constants.ts`, `helpers.ts`, `helpers.test.ts`, `service.ts`,
    `service.test.ts`, `repository.ts`, `routes.ts`)
  - `server/src/modules/index.ts`
  - `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`
  - `server/test/contracts.test.ts`, `server/test/smart-diff*.test.ts` (only if vitest does not pick up
    tests under `src/` — check `server/vitest.config.*` first; do not edit that config)
- Skills to apply: `onion-architecture` (Mandatory, glob `server/src/modules/**`); `fastify-best-practices`
  (Mandatory, glob `routes.ts`); `zod` (Mandatory, glob `server/src/vendor/shared/**`); `security`
  (Always-on — new API endpoint taking a path param); `engineering-insights` (closing step).
- Implementation notes:
  - `constants.ts`: `ROLE_ORDER` and ordered `ROLE_RULES: { role; patterns: RegExp[] }[]` in the order
    boilerplate → tests → wiring → docs (core = fallback). Patterns exactly per assignment §"Starter
    classification patterns". Match against the normalised path (backslashes → `/`); basename rules
    (`index.ts`, `*.config.*`, `README*`, `LICENSE`) must match at any depth.
  - `helpers.ts`: `classifyFile(path: string): SmartDiffRole` (first matching rule wins),
    `selectLatestReviews(...)` (rule in Shared contracts §3), `buildSmartDiff(files, findings): SmartDiff`.
  - `repository.ts`: reads persisted PR files (`pr_files`: path/additions/deletions) and the PR's reviews
    + findings. Reuse existing `reviews` repository functions (`review.repo.ts#reviewsForPull`,
    `pull.repo.ts`) where they fit; never call GitHub/Octokit or any LLM adapter.
  - `service.ts`: `getSmartDiff(workspaceId, prId)`; unknown/foreign PR → `NotFoundError`; result passed
    through `SmartDiffResponse.parse` before return.
  - `routes.ts`: `GET /pulls/:id/smart-diff`, `schema: { params: IdParams }`, `getContext` for workspace.
- Acceptance criteria:
  - `diff server/src/vendor/shared/contracts/brief.ts client/src/vendor/shared/contracts/brief.ts` shows no
    difference inside the `// ---- Smart Diff ----` block, and
    `grep -n "SmartDiffRole = z.enum(\['core', 'tests', 'wiring', 'docs', 'boilerplate'\])"` matches in both files.
  - `server/test/contracts.test.ts` asserts `SmartDiffRole.options` equals the 5 values in `ROLE_ORDER` order
    and that a sample 5-group payload parses with `SmartDiff`.
  - `helpers.test.ts` is a `it.each` table "path → role" with ≥ 20 rows covering every pattern family, and
    contains these exact rows: `client/src/__tests__/__snapshots__/x.snap → boilerplate`,
    `.claude/skills/security/SKILL.md → wiring`, `e2e/README.md → tests`, `server/pnpm-lock.yaml →
    boilerplate`, `client/package-lock.json → boilerplate`, `server/src/modules/intent/service.ts → core`,
    `server/src/modules/index.ts → wiring`, `docs/plans/smart-diff.md → docs`, `README.md → docs`,
    `server/src/x.it.test.ts → tests`, `client/next.config.ts → wiring`.
  - All patterns and the role order live only in `smart-diff/constants.ts`:
    `grep -rn "pnpm-lock" server/src/modules/smart-diff` matches only `constants.ts` (and test files).
  - `helpers.ts` / `constants.ts` import nothing from `fastify`, `drizzle-orm`, `../../db`, `../../platform`
    (grep returns nothing).
  - `service.test.ts` (mocked repository, no DB) proves: (a) PR with zero reviews → 5 groups in
    `ROLE_ORDER`, every `finding_lines` is `[]`, empty roles have `files: []`; (b) two reviews by the same
    agent → only the newest one's findings produce `finding_lines`; two agents → both newest reviews count;
    (c) `finding_lines` are sorted and unique; (d) `total_lines` = Σ(additions+deletions), `too_big` false,
    `proposed_splits` `[]`; (e) output passes `SmartDiffResponse.parse`; (f) unknown PR → `NotFoundError`.
  - No model call: `grep -rniE "llm|openai|anthropic|provider|octokit" server/src/modules/smart-diff`
    returns nothing; the service constructor takes only the repository.
  - `grep -n "smart-diff\|smartDiff" server/src/modules/index.ts` shows the module registered.
- Done-condition: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
  (only the 6 known `indexer-pipeline.test.ts` Windows failures are tolerated) and
  `cd client && pnpm typecheck` (client `brief.ts` copy changed).

### Task T2: Generic diff-viewer — findings on file card, under the line, and outside the patch
- Requirement-ID: P1 (dot on file card; finding comment under the line with severity/title/rationale via
  render-prop); P2 (coloured stripe + severity label, out-of-patch block, hidden by the comments toggle);
  P3 (finding comment collapsible to one line)
- Depends-on: none (API fixed in Shared contracts §4)
- Owned paths: `client/src/components/diff-viewer/**`
- Skills to apply: `frontend-ui-architecture` (Mandatory, `client/src/**`); `react-best-practices`
  (Mandatory, `*.tsx`); `react-testing-library` (Mandatory, `*.test.tsx`); `engineering-insights` (closing step).
- Implementation notes: add `findings.ts` (types + pure helper `partitionFindings(findings, parsedLines)`
  → `{ byKey: Map<string, DiffFinding[]>, outside: DiffFinding[] }`, modelled on `partitionThreads`); thread
  `findings` prop `DiffViewer → FileCard → CodeLine`; the findings dot sits next to the existing comment
  counter (separate element, no number); line stripe = `borderLeft` in `SEV[severity]` colour; label uses
  `SEV`/`SeverityBadge` word mapping from Shared contracts §4 (add a `FINDING_LINE_LABEL` map to
  `diff-viewer/constants.ts` only if `SEV` has no such word). Out-of-patch block rendered at the end of the
  file body, styled like `OutdatedComments/`. If several findings hit one line, the highest severity wins
  the stripe/label; all cards render. Collapse: each inline finding wrapper has a button
  (`aria-expanded`) that collapses it to a one-line title row.
- Acceptance criteria:
  - `grep -rn "app/\|FindingCard" client/src/components/diff-viewer --include=*.ts --include=*.tsx`
    returns nothing (no import from route folders).
  - `findings.ts` exports `DiffFinding`, `DiffFindingApi`, `DiffFindingSeverity`, `partitionFindings`
    with exactly the shapes in Shared contracts §4.
  - Unit test `findings.test.ts`: finding on an added/context line → `byKey` key `RIGHT:<n>`; finding whose
    `start_line` is not in the patch → `outside`; `patch: null` → all findings `outside`.
  - RTL test (`FileCard.test.tsx` or `DiffViewer.test.tsx`), with a real 2-hunk patch fixture:
    - file with ≥1 finding renders exactly one `file-finding-dot` and it contains no digits; a file without
      findings renders none; the existing comment counter is still rendered independently.
    - with `show: true`, `renderFinding` output appears in a `diff-finding-inline` node placed immediately
      after the code row of `start_line`; that row has `data-finding-severity="WARNING"` and a
      `finding-line-label` with text `warning` (and `blocker` for CRITICAL).
    - a finding outside the patch is rendered inside `diff-findings-outside`, not dropped.
    - with `show: false`, no `diff-finding-inline`, no `data-finding-severity`, no `finding-line-label`
      (dot still shown).
    - clicking the collapse button sets `aria-expanded="false"` and hides the render-prop body while the
      title stays visible.
    - `findings` omitted → markup identical to before (existing viewer tests stay green unchanged).
- Done-condition: `cd client && pnpm test && pnpm typecheck`

### Task T3: Smart Diff UI on Files changed — groups, toggle, counters, inline FindingCard
- Requirement-ID: P1 (5 labelled groups with file count, docs/boilerplate collapsed, `● N` on group header,
  inline finding comment, Original order toggle); P2 (Accept/Dismiss in the inline card, findings hidden by
  the GitHub-comments toggle, grouping before first review); P3 (sticky header, empty state, update after
  Run review without reload, labels from `prReview.json`)
- Depends-on: [T1, T2]
- Owned paths:
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/**`
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffGroup/**` (new)
  - `client/src/lib/hooks/reviews.ts`
  - `client/messages/en/prReview.json`
  - `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (only for passing props / invalidation)
- Skills to apply: `frontend-ui-architecture`, `react-best-practices`, `next-best-practices`
  (`client/src/app/**`), `react-testing-library` (all Mandatory by glob); `security` (Always-on — renders
  LLM-produced finding text: plain text only, no `dangerouslySetInnerHTML`); `engineering-insights` (closing step).
- Implementation notes:
  - `useSmartDiff(prId)` in `hooks/reviews.ts`: `queryKey ["smart-diff", prId]`,
    `api.get<SmartDiffResponse>(\`/pulls/${prId}/smart-diff\`)`, `enabled: !!prId`. Wherever the code
    invalidates/refetches `["reviews", prId]` after a run settles (page.tsx / run hooks), also invalidate
    `["smart-diff", prId]`; `useFindingAction` success also invalidates it.
  - `DiffTab`: local state `order: "smart" | "original"` (default `"smart"`) with a segmented control
    (`smartOrder` / `originalOrder`). Original = the current `DiffViewer` render with the PR's files in
    GitHub order (plus `findings`). Smart = header "REVIEWER-ORDERED DIFF", "N files · +A −D", then one
    `SmartDiffGroup` per server group; file objects (with `patch`) are looked up by path from the PR
    detail's `files`, order inside a group follows the server response.
  - Findings: `selectLatestFindings(reviews)` (rule in Shared contracts §3) → `byPath` map → one
    `DiffFindingApi` with `show` bound to the **existing** Show/Hide comments toggle, and
    `renderFinding` = existing `FindingCard` (looked up by `f.id`) wired to `useFindingAction` for
    Accept/Dismiss.
  - `SmartDiffGroup`: row = chevron, coloured square, role label + description, then on the right
    `smart-diff-group-findings` (`● N`, N = files in group with `finding_lines.length > 0`, shown only if a
    review exists) and `filesCount`. Header `position: sticky; top: 0`. Default expanded unless role is
    `docs` or `boilerplate`; files inside use the existing `AUTO_EXPAND_MAX_LINES` rule via `DiffViewer`/`FileCard`.
    Empty groups render with "0 files" (P1 "five groups").
  - Empty state: if there are no reviews of kind `review`, show `noReviewYet` instead of `● 0` counters.
  - i18n (`smartDiff` key): add `testsLabel`, `docsLabel`, `smartOrder`, `originalOrder`, `noReviewYet`,
    `reviewerOrdered`, `coreDesc`, `testsDesc`, `wiringDesc`, `docsDesc`, `boilerplateDesc`; keep existing keys.
- Acceptance criteria:
  - `grep -n "\"testsLabel\"\|\"docsLabel\"\|\"smartOrder\"\|\"originalOrder\"\|\"noReviewYet\"" client/messages/en/prReview.json`
    returns 5 lines; `grep -rnE "\"(Core|Tests|Wiring|Docs|Boilerplate)\"" .../_components/SmartDiffGroup .../_components/DiffTab --include=*.tsx`
    (non-test files) returns nothing — labels come from `useTranslations`.
  - `DiffTab/helpers.test.ts`: `selectLatestFindings` uses the same fixture semantics as T1 (same agent twice
    → only newest; two agents → both; `kind: 'summary'` ignored).
  - `DiffTab.test.tsx` (hooks mocked with `vi.mock("…/lib/hooks/reviews")`) with a PR containing
    `src/a.ts`, `src/a.test.ts`, `src/index.ts`, `README.md`, `pnpm-lock.yaml`:
    - renders `smart-diff-group-core`, `-tests`, `-wiring`, `-docs`, `-boilerplate` in this DOM order,
      each showing its translated label and file count;
    - `pnpm-lock.yaml` is inside `smart-diff-group-boilerplate`; docs and boilerplate groups have their file
      list collapsed (`aria-expanded="false"` on the chevron button, file path not visible) while core is expanded;
    - with a review whose findings hit `src/a.ts` twice (two lines), core's `smart-diff-group-findings` reads `1`;
    - `src/a.ts` card shows `file-finding-dot`, and the expanded file shows the FindingCard title and
      rationale under the line;
    - clicking Accept calls the mocked `useFindingAction` mutate with the finding id and `"accept"`;
    - toggling the existing Hide comments control removes the inline finding card;
    - clicking `originalOrder` renders files in the input (GitHub) order with no group headers; clicking
      `smartOrder` restores the groups;
    - with zero reviews: all 5 groups render, `noReviewYet` text is shown, no `smart-diff-group-findings`.
  - `grep -n "\"smart-diff\"" client/src/lib/hooks/reviews.ts client/src/app/repos/\[repoId\]/pulls/\[number\]/page.tsx`
    shows the query key used in `useSmartDiff` and in at least one `invalidateQueries` call.
  - `grep -rn "dangerouslySetInnerHTML" .../_components/SmartDiffGroup .../_components/DiffTab` returns nothing.
- Done-condition: `cd client && pnpm test && pnpm typecheck`; then (feature gate, orchestrator)
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`.

## Out of scope / deferred
- Real `split_suggestion` logic (`too_big` heuristics, `proposed_splits`) and `pseudocode_summary`.
- Using `classifyFile` as a pre-prompt filter (L08) — only keep it importable.
- Changes to the Agent runs / Findings tab; e2e tests (`e2e/`); `.it.test.ts` for the route (unit tests
  with a mocked repository cover it).
- Syncing other diverged symbols between the two `vendor/shared` copies.
- The PR, its description and the demo video (P1/P2 "PR description" items) — done by the orchestrator/user
  after the pipeline; the description must list the subagents used and the `plan-verifier` result.

## Open questions
- Dismissed findings: plan includes them in `finding_lines` / `● N` (card shows state). If the mentor
  expects dismissed findings to disappear from counters, filter `dismissed_at == null` in **both**
  `selectLatestReviews` (T1) and `selectLatestFindings` (T3) together.
- `e2e/README.md → tests` follows the starter order and is pinned in the T1 table; changing it requires
  changing the test row deliberately.
- If `SEV`/`SeverityBadge` exposes different words than `blocker/warning/suggestion`, T2 adds the mapping
  to `diff-viewer/constants.ts` (not a new palette).

## Red flags
- Contract drift: forgetting the client `brief.ts` copy compiles on the server but breaks client types.
- Server `● N` and client inline cards use two implementations of one selection rule — both tests must
  use the same fixture semantics; a mismatch is visible in the demo video.
- `diff-viewer` importing from `app/**` is an architecture violation even if it type-checks.
- Group collapse must not override per-file `AUTO_EXPAND_MAX_LINES` inside expanded groups.
- The new endpoint must stay workspace-scoped (`getContext` + PR lookup by workspace) — no cross-workspace reads.
- Do not touch `server/src/db/migrations/**` or any lock file; no new dependencies.
