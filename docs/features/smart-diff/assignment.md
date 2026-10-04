# Assignment: Smart Diff (L03 homework)

English transcription of the course assignment (original: Ukrainian PDF whose
text is rendered as vector outlines, so agents cannot read it). This file is
the source of truth for `planner` and `plan-verifier`.

## What we are doing

In the lab we assembled a set of subagents and built the Intent Layer, which
explains to the reviewer why the PR was opened. This homework closes the
neighbouring problem: **in what order the reviewer reads the changes, and where
they see the review result.**

Today the **Files changed** tab shows files in the order GitHub returned them,
so a lock file sits next to business logic. Agent findings live separately, on
the **Agent runs** tab, and to match a finding to code you have to jump
between tabs.

## Smart Diff does two things

- **Sorts PR files by role:**
  - first `core` (business logic)
  - then `tests`, `wiring` (configuration, barrel files), `docs`
  - last `boilerplate` (lock files, generated code, snapshots)
- **Shows the review result in the diff:**
  - on the group header — how many files in the group have findings
  - on the file card — an indicator that findings exist
  - under the relevant code line — a comment with the finding, like on the Agent runs tab

**Submission:** open a PR in your DevDigest fork with an implementation
description and a 1–3 minute demo video. Video script — see "How to verify".

**Definition of done:** all P1 criteria are met and visible in the video. P2
and P3 do not block acceptance — the mentor comments on them in the PR.

## User stories ("As a user I can…")

- Open a pull request, go to **Files changed** and see files grouped by role
  `core → tests → wiring → docs → boilerplate`, each group labelled with its
  role and file count.
- See that `docs` and `boilerplate` are collapsed, and the lock file is in
  `boilerplate`.
- Run **Run review** and, after it finishes, see on the group header a counter
  of files with findings, and on the cards of those files a dot indicator.
- Expand such a file and see a finding comment under the relevant line. UI-wise
  it should look like the comment on the Agent run page; the same code can be
  reused.
- Switch to **Original order** when the usual GitHub order is needed.

Prototype details (from screenshots): header "REVIEWER-ORDERED DIFF",
"9 files · +247 −38", a segmented control **Smart order | Original order** on
the right. Group row: chevron, coloured square, role name, role description
(e.g. "Core logic — The substance of the change — review closely", "Wiring —
Hooks the core into the app", "Boilerplate — Generated / mechanical — skim"),
and on the right `● N` (red dot + number of files with findings) then
`N files`. Finding line: coloured left stripe, label on the right (e.g.
`⚠ warning`); the finding card below shows severity, title, category,
`line N · NN% conf`, rationale, "Suggested fix", Accept / Dismiss, close ×.

## What already exists in the starter

Everything below is already in the starter. Your fork may differ since L01 —
search your own code first. The main point: do not write this from scratch.

### Server data

- `GET /pulls/:id` returns `files[]` of type `PrFile`: `path`, `additions`,
  `deletions`, `patch` (unified diff, may be `null`). Enough for classification.
- `GET /pulls/:id/reviews` returns reviews with `findings[]`. Finding fields:
  `file`, `start_line`, `end_line`, `severity` (`CRITICAL | WARNING | SUGGESTION`),
  `title`, `rationale`, `suggestion`, `confidence`, `accepted_at`,
  `dismissed_at`. There is no separate `line` field — anchor to `start_line`.
- On the client these come from ready hooks in `client/src/lib/hooks/reviews.ts`:
  `usePrReviews(prId)` for findings and `useFindingAction()` for accept/dismiss.
  `FindingsTab` already uses them; the query is cached, so calling it again from
  Files changed costs nothing.

### Contract

- Zod contract `SmartDiff` lives in `server/src/vendor/shared/contracts/brief.ts`
  (identical second copy in `client/src/vendor/shared/contracts/brief.ts`):
  `groups[{ role, files[{ path, additions, deletions, finding_lines[], pseudocode_summary? }] }]`
  + `split_suggestion { too_big, total_lines, proposed_splits[] }`.
  The response type `SmartDiffResponse` is already declared in `review-api.ts`.
  **You create the route that returns it.**
- **Note:** `SmartDiffRole` in that file is `z.enum(['core', 'wiring', 'boilerplate'])`
  — only three values. To add `tests` and `docs`, extend the enum **in both
  copies** of `brief.ts`; they must stay identical or server and client types diverge.

### Components

- The `DiffTab` tab renders `DiffViewer` from `client/src/components/diff-viewer/`.
  `FileCard` can already collapse, auto-expands files up to 200 lines
  (`AUTO_EXPAND_MAX_LINES` in `constants.ts`) and already shows a comment
  counter in its header — the findings dot goes next to it, following the same pattern.
- `parsePatch` in `helpers.ts` returns lines with `oldNo` / `newNo`. No need to
  write your own diff parser.
- **Comments can already live under a code line.** In `comments.ts`,
  `keysForLine(ln)` gives the line key (`RIGHT:<new line>` or `LEFT:<old line>`),
  and `partitionThreads` separates threads that found their line from those
  that did not. `CodeLine` then draws them under the line. Attach a finding the
  same way: key `RIGHT:${finding.start_line}`.
- **The card does not need to be drawn from scratch either.** It already exists
  on the Agent runs tab — `FindingCard` in `_components/FindingCard/`. Take it
  or make a simpler copy: severity, title, rationale and Accept / Dismiss buttons.
- Severity colours and icons live in one place: `SEV` and `SeverityBadge` in
  `client/src/vendor/ui/primitives/Badge.tsx`. For the line label, colour and
  word from there are enough — do not introduce your own palette.
- UI strings for Smart Diff live in `client/messages/en/prReview.json`, key
  `smartDiff`: `coreLabel`, `wiringLabel`, `boilerplateLabel`, `groupedByRole`,
  `filesCount`, `findingLines`. For the new roles add `testsLabel` and `docsLabel`.

## Starter classification patterns

Check order matters more than the patterns themselves: **the first matching rule wins.**

1. `boilerplate` — `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`,
   `dist/**`, `build/**`, `**/__snapshots__/**`, `*.snap`, `*.generated.*`, `*.min.js`.
2. `tests` — `**/*.test.ts(x)`, `**/*.it.test.ts`, `**/*.spec.ts`, `**/test/**`,
   `**/tests/**`, `**/__tests__/**`, `e2e/**`.
3. `wiring` — `index.ts` / `index.js` (barrel files), `*.config.*`, `tsconfig*.json`,
   `.eslintrc*`, `.env*`, `docker-compose*.yml`, `.github/**`, `.claude/**`.
4. `docs` — `**/*.md`, `docs/**`, `README*`, `CHANGELOG*`, `LICENSE`.
5. `core` — everything else.

Three cases where the order is most visible; put them in the test table:

- `__snapshots__/x.snap` inside `__tests__` → `boilerplate`, because the
  snapshots rule is above the tests rule.
- `.claude/skills/security/SKILL.md` → `wiring`: markdown here defines agent
  behaviour, so `.claude/**` is above the docs rule.
- `e2e/README.md` → by this order goes to `tests`. If you think otherwise,
  change the rule and pin your decision in a test.

Your layout may differ from ours; what matters is that the decision was
deliberate and pinned in the table.

## Test PR

Smart Diff is checked on a PR in your DevDigest fork, added to DevDigest as a
repository. The PR must contain at least one lock file (`pnpm-lock.yaml`
appears in any PR where you added a dependency), one logic file in
`server/src/` or `client/src/`, one test and one config or barrel file. A
branch with one new dependency, a small module change and a test for it gives
all the needed groups.

After Run review this PR must have at least one finding in a file from the
`core` group. For a stable result choose a stronger model for the review in
the agent settings.

## How findings are shown in the diff

Findings are visible in three places (all three are on the screenshots):

- **group header** — a dot with a number on the right, before "N files". The
  number is **how many files in the group have findings**, not how many
  findings in total. Two files with findings give `● 2` even if they have five findings;
- **file card** — a dot next to the path, **no number**. Next to it is already
  the comment counter with a message icon — that is a different thing: it
  counts human GitHub comments. Two different marks, do not mix them up;
- **code line** — under it a comment with the finding: severity, title,
  rationale and Accept / Dismiss buttons. Looks the same as the finding card on
  the Agent runs tab. The line itself is additionally marked with a coloured
  stripe on the left and a label on the right: `CRITICAL → blocker`,
  `WARNING → warning`, `SUGGESTION → suggestion`.

The point: the reviewer reads code and explanation in one place and does not
jump between tabs. The Agent runs tab stays as is — it shows whole runs.

## Possible implementation

1. **Classifier.** Pure function `classifyFile(path): SmartDiffRole` in
   `server/src/modules/reviews/smart-diff/` (or a separate `smart-diff/`
   module), patterns and role order in `constants.ts`. First write the test
   table "path → role", then the implementation, so the rule order becomes an
   explicit decision. Keep the function independent of the route: in L08 this
   same classifier becomes a filter before prompt assembly, so it must be
   importable and work without an HTTP request.
2. **Contract.** Extend `SmartDiffRole` to five values in
   `server/src/vendor/shared/contracts/brief.ts` and in the client copy. Add
   `testsLabel` and `docsLabel` to `prReview.json`.
3. **Route `GET /pulls/:id/smart-diff`.** Takes the PR files and the findings
   of the latest review, distributes files into groups in a fixed role order,
   collects `finding_lines` from `start_line`, returns `SmartDiff`. Fill
   `split_suggestion` minimally: `too_big: false`,
   `total_lines = sum(additions + deletions)`, `proposed_splits: []`. Nothing
   more is needed from it.
4. **Groups on the Files changed tab.** Role header with file count; `docs` and
   `boilerplate` collapsed by default, the rest per the existing
   `AUTO_EXPAND_MAX_LINES` rule.
5. **Findings in the diff.** Take them with `usePrReviews(prId)` in `DiffTab`
   and pass into `FileCard` next to `commenting`. Then three places: file
   counter in the group header, dot in the file header and the comment under
   the line. Find the line via `keysForLine`, take the card from `FindingCard`.

Build the feature through the lab pipeline: `planner → implementer →
(architecture-reviewer ∥ plan-verifier)`. In the PR description briefly state
what each subagent did and what `plan-verifier` found.

## Acceptance criteria

### P1 — blocking

- The opened pull request on Files changed shows five groups in order
  `core → tests → wiring → docs → boilerplate`, each labelled with role and file count.
- The lock file is classified as `boilerplate`; `docs` and `boilerplate` are
  collapsed on open.
- After Run review the group header shows the counter of files with findings.
- The card of a file with findings shows a dot indicator.
- In an expanded file, under the relevant line, a finding comment is visible:
  severity, title and rationale.
- The Original order toggle returns the usual GitHub order.
- There is an open PR with an implementation description and demo video.

### P2 — non-blocking, mentor comments in PR

- Patterns and role order are in one constants file; there is a unit test of
  the classifier on the "path → role" table, including the three disputed cases above.
- The route returns a response that passes `SmartDiff` contract validation;
  the enum is extended in both copies of `brief.ts`.
- Viewing Smart Diff produces no new model call in the logs; grouping works
  even before the first review.
- The line with a finding is marked with a coloured stripe and severity label,
  as in the prototype.
- Accept / Dismiss buttons in the comment work and change the finding state.
- A finding whose line did not make it into the patch is shown as a separate
  block at the end of the file, not lost.
- Finding comments can be hidden with the same toggle as GitHub comments, so
  the diff stays clean.
- The PR description states which subagents were used and what `plan-verifier` checked.

### P3 — nice to have

- The group header sticks to the top while scrolling, as in the prototype.
- A finding comment can be collapsed into one line.
- Empty state "review has not been run yet" instead of zero counters.
- Counters and indicators update after Run review without page reload.
- Group names and other labels are not hard-coded in the component but come
  from `client/messages/en/prReview.json`, key `smartDiff`. `coreLabel`,
  `wiringLabel`, `boilerplateLabel` and the file-count label are already
  there — add `testsLabel` and `docsLabel` for the new groups.

## How to verify (also the video script)

1. Open the test pull request → Files changed → show five groups with labels
   and counters, `docs` and `boilerplate` collapsed.
2. Expand `boilerplate` so the lock file inside is visible.
3. Click Run review, wait for completion, go back to Files changed → show the
   counter of files with findings on the group header and the dot on the file card.
4. Expand the file with a finding → show the comment under the relevant line.
   Then switch to Original order and back.
5. In one sentence say why grouping does not call the model.
