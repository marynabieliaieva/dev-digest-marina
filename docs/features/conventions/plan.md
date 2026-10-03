# Conventions Extractor — implementation plan

Status: draft 2026-09-21. Lesson `lesson_02` (part 2). Follows
[`../skills/plan.md`](../skills/plan.md).

Scan a cloned repo → sample files **in code** (no model) → one cheap model call
returns rule candidates with `file:line` evidence → **verify every citation in
code** and drop what can't be proven → user accepts / rejects / edits → merge the
accepted set into one `repo-conventions` skill and link it to an agent.

A convention candidate is **data**; the skill it becomes is **configuration text**.
Nothing extracted here ever executes.

---

## 1. What already exists (starter scaffolding — do not rebuild)

| Layer | State | File |
|---|---|---|
| DB | `conventions` table exists, empty, never read/written | `server/src/db/schema/knowledge.ts:31` |
| Contract | `ConventionCandidate` in **both** vendored copies | `*/src/vendor/shared/contracts/knowledge.ts:189` |
| Feature model | `conventions` entry, default `openai / gpt-5.4`; `getFeatureModelOverride` is documented as "callers with a dynamic default (e.g. conventions)" | `contracts/platform.ts:74`, `modules/settings/feature-models.ts:30` |
| Sampling | `repoIntel.getConventionSamples(repoId, n)` — top-N by PageRank, junk (tests/configs/migrations) filtered | `modules/repo-intel/service.ts:630` |
| Test mock | `MockLLMProvider.structuredBySchema` exists **specifically** for the 2-step conventions dialogue: `'ConventionFileSelection'` then `'ConventionExtraction'` | `adapters/mocks.ts:48-56` |
| i18n | `messages/en/conventions.json` — page/empty/card strings already written | `client/messages/en/conventions.json` |
| Routing | `activeKeyFor` already maps `/conventions` → nav key `conventions` | `components/app-shell/helpers.ts:31` |
| Skills | full CRUD + versions + import preview + `source: 'extracted'` + `evidence_files` column | `modules/skills/*` |
| Agent ⇄ skill | `POST /agents/:id/skills` with order + per-link `enabled` | `modules/agents/*` |
| Prompt injection | linked skills already reach the review prompt via `run-executor` | `modules/reviews/run-executor.ts` |

The `structuredBySchema` mock and the "dynamic default" comment are the two
strongest signals about the intended design: **two model calls**, and the feature
owns its own default model.

## 2. What is missing

1. No `server/src/modules/conventions/` at all — no route, no service, no repository.
2. The `conventions` table cannot express the required UX: no tri-state status
   (pending/accepted/rejected), no category, no evidence **line**, no scan-run
   metadata ("Detected from 84 sample files · last scan 1h ago"), no link to the
   skill that was produced.
3. No evidence-verification step anywhere (`groundFindings` in `reviewer-core` is
   diff-anchored; conventions are clone-anchored — different input).
4. Client: no `/repos/:repoId/conventions` route, no hooks, no NAV entry
   (`activeKeyFor` points at a key that `nav.ts` does not define).
5. `conventions.json` covers the *single*-accept flow only; the target UX is
   multi-select → merge into one skill via a modal.
6. Seed has no conventions rows → the page is empty without an API key, and e2e
   has nothing to drive.
7. API Contract Reviewer (part 3) has the agent + prompt + one broad
   `api-contract-gate` skill, but not the four granular skills, and no
   with/without experiment record.

---

## 3. Decisions

1. **Async via JobRunner, not inline.** `POST /repos/:id/conventions/extract`
   enqueues `conventions.extract` and returns `202 { extractionId }`; the client
   polls `GET /repos/:id/conventions`. Mirrors `POST /repos/:id/resync`
   (`repo-intel/routes.ts:43`) rather than the SSE run pipeline — there is no
   per-token output to stream.
2. **Two model calls** (matching the mock fixture keys):
   `ConventionFileSelection` (paths + repo map only, no bodies → cheap) then
   `ConventionExtraction` (selected bodies, line-numbered). Both are
   `completeStructured` with the `schemaName` the mock already expects, so the
   unit suite stays hermetic.
3. **Evidence verification is pure code, in `helpers.ts`** — a new
   `groundConventions()`, not a change to `reviewer-core`. Ungrounded candidates
   are **dropped**, counted, and the count is shown in the UI subtitle.
4. **Tri-state `status`, not the boolean `accepted`.** The column is unused and
   the table is empty, so replacing it is free — but it *is* a contract change
   that must be hand-copied into both `vendor/shared` copies.
5. **New `convention_extractions` table.** Needed for the header line, and it
   makes a re-scan a new row instead of a destructive overwrite (old candidates
   stay queryable; the list returns the latest extraction only).
6. **Merge-to-one-skill is the primary flow** (screenshot: `Create skill` →
   modal, `Merged from 3 accepted conventions`). Per-candidate "accept as skill"
   is dropped; the merged body is fully editable before save, exactly like the
   skill *import* preview → confirm split.
7. **Preview persists nothing.** `POST /repos/:id/conventions/skill-preview`
   returns a draft body; the save step is a separate call. Same security posture
   as `POST /skills/import/preview`.
8. **Repo-scoped page**, not global: `/repos/:repoId/conventions`, because
   conventions are per-repo (`conventions.repo_id`).

---

## 4. Work packages

### W0 — schema + migration (server)

Edit `db/schema/knowledge.ts`, then `pnpm db:generate` (**never hand-write the
SQL** — `migrations/**` is generated and immutable, see root `CLAUDE.md`).

```ts
export const conventionExtractions = pgTable('convention_extractions', {
  id, workspaceId, repoId,
  status: text({ enum: ['running', 'done', 'failed'] }),
  sampledFiles: integer(),        // → "Detected from 84 sample files"
  candidatesRaw: integer(),       // what the model returned
  candidatesKept: integer(),      // what survived grounding
  provider, model: text(),
  error: text(),
  createdAt: now(), finishedAt: timestamp(),
});
```

`conventions` gains: `extractionId` (FK, cascade), `category`,
`evidenceLine` (integer), `status` (`pending|accepted|rejected`, replaces
`accepted`), `edited` (boolean — the user rewrote the rule), `skillId`
(FK → `skills.id`, `on delete set null`), `createdAt`.

Contract (`contracts/knowledge.ts`, **both** copies):
`ConventionCandidate` gains `category`, `evidence_line`, `edited`, `skill_id`;
`accepted: boolean` → `status: ConventionStatus`. Add
`ConventionExtractionSummary` and `ConventionsPage = { extraction, candidates }`.

### W1 — `modules/conventions/` (server)

Role-named files per the repo convention:

| File | Content |
|---|---|
| `constants.ts` | `EXTRACT_JOB_KIND`, `SAMPLE_FILE_COUNT = 12`, `MAX_FILE_LINES`, `MAX_SAMPLE_TOKENS`, `CONFIG_ALLOWLIST`, `DEFAULT_MODEL` (`openai/gpt-5.4`), `EVIDENCE_LINE_TOLERANCE = 3`, `CATEGORIES` |
| `repository.ts` | `conventions` + `convention_extractions` data access, workspace-scoped on **every** read and write |
| `service.ts` | the pipeline (below), job handler registration |
| `helpers.ts` | `pickConfigFiles`, `numberLines`, `groundConventions`, `dedupeRules`, `mergeToSkillBody`, `toCandidateDto` |
| `routes.ts` | the five routes |

**Pipeline** (`service.extract`):

1. **Sample — code only, no model.**
   *Configs*: read a fixed allowlist off the clone root — `eslint.config.*`,
   `.eslintrc*`, `tsconfig*.json`, `.prettierrc*`, `.editorconfig`,
   `package.json` (scripts + deps only), `CLAUDE.md` / `AGENTS.md` if present.
   *Source*: `repoIntel.getConventionSamples(repoId, 12)`.
   Read via the clone path (`repos.clonePath`), each file truncated to
   `MAX_FILE_LINES` and **prefixed with 1-based line numbers** — the model cannot
   cite a line it was not shown, which makes step 4 cheap and strict.
   Budget with `container.tokenizer`. Degrades to `[]` when the repo is
   unindexed → extraction finishes `done` with 0 candidates, never throws.
2. **Call 1 — `ConventionFileSelection`.** Input: the candidate path list +
   `repoIntel.getRepoMap()`. Output: the ≤8 paths worth reading in full, with a
   one-line reason each. Cheap (no bodies) and it is what makes the second call's
   context small enough to stay on a cheap model.
3. **Call 2 — `ConventionExtraction`.** Input: the selected line-numbered bodies
   + the config digest. Output: `{ category, rule, evidence: { path, line,
   snippet }, confidence }[]`. Prompts live in
   `src/prompts/conventions.select.md` + `conventions.extract.md` (loaded with
   `renderPrompt`, per `platform/prompts.ts`). Model resolved with
   `getFeatureModelOverride(container, ws, 'conventions') ?? DEFAULT_MODEL` —
   the "dynamic default" path the settings module documents.
4. **Ground — pure code, no model.** A candidate survives only if:
   the cited path is in the sampled set **and** exists in the clone;
   `evidence_line` is within the file; the snippet appears within
   ±`EVIDENCE_LINE_TOLERANCE` lines of the cited line after whitespace
   normalisation; `rule` is non-empty and ≤ 240 chars;
   `confidence ∈ [0,1]`; and the normalised rule text is not a duplicate of one
   already kept, nor of an existing enabled skill body in the workspace.
   Everything else is dropped and counted into `candidatesRaw - candidatesKept`.
5. **Persist** the extraction row + the surviving candidates (`status: 'pending'`).

**Routes:**

```
POST  /repos/:id/conventions/extract         → 202 { extractionId }   (enqueue)
GET   /repos/:id/conventions                 → { extraction, candidates }
PATCH /conventions/:id                       → accept / reject / edit rule+category
POST  /repos/:id/conventions/skill-preview   → draft skill (persists NOTHING)
POST  /repos/:id/conventions/skill           → create skill + stamp skill_id + optional agent link
```

`skill-preview` returns `{ name: '<repo>-conventions', description: 'N house
conventions extracted from <repo>', type: 'convention', body, token_count }`.
`mergeToSkillBody` renders one `##` section per accepted convention — rule,
`Detected in \`path:line\``, and the fenced snippet — under a directive header
("Flag changes that violate any rule below and cite the offending `file:line`").
The save route delegates to `SkillsService.create` with
`source: 'extracted'`, `evidenceFiles: [...paths]`, `enabled` from the modal
(default **on** — unlike an import, this text came from the user's own repo and
they just reviewed it rule by rule), then stamps `conventions.skill_id` and, when
`agent_id` is passed, appends the link via the agents service.

Register in `modules/index.ts` (one import + one entry).

### W2 — client hooks

`client/src/lib/hooks/conventions.ts` (one file per domain):
`useConventions(repoId)` — polls every 1.5 s while `extraction.status ===
'running'`, same shape as `useRepoIntelStatus(…, poll)`;
`useExtractConventions`, `useUpdateConvention` (optimistic status flip),
`useConventionSkillPreview`, `useCreateSkillFromConventions` (invalidates
`["skills"]`, `["conventions", repoId]`). Export from `hooks/index.ts`.

### W3 — client page

`app/repos/[repoId]/conventions/page.tsx` (thin) +
`_components/ConventionsView/` with `_components/ConventionCard/` and
`_components/CreateSkillModal/` — `<Name>.tsx` + `styles.ts` + `constants.ts` +
`index.ts` per the route-local PascalCase convention.

- Header: `Conventions in <repo>`, subtitle `Detected from N sample files · last
  scan …`, `Re-scan` button (spinner + disabled while running).
- Toolbar: `Select all` / `Deselect all`, `N of M accepted`, `Create skill`
  (disabled at 0 accepted).
- Card: rule (inline-editable on click → `edited: true`), evidence
  `path:line` chip with a copy button, fenced snippet, confidence bar
  (≥0.85 green / ≥0.70 amber / below red), `Accepted` / `Reject` pair.
  Rejected cards collapse and grey out but stay listed (undo is one click).
- Modal: name, description, type select, `Enabled` toggle, body editor with the
  filename header + token count, footer `Saved as v1 · added to Skills Lab`,
  `Cancel` / `Create skill`. On success → toast + route to `/skills/<id>`.

`vendor/ui/nav.ts`: add to the `SKILLS LAB` group
`{ key: "conventions", label: "Conventions", icon: "ListChecks", href:
"/repos/:repoId/conventions", gKey: "c" }` + a `g c` entry in `SHORTCUTS`.
`activeKeyFor` already handles the rest.

Extend `messages/en/conventions.json` (keep the existing keys; add
`toolbar.*`, `card.reject/rejected/edit/evidence`, `modal.*`, `grounding.dropped`).

### W4 — seed

Add ~4 `conventions` rows + one `done` extraction for `payments-api` to
`seed.ts` (new `seed-conventions.ts`, mirroring `seed-skills.ts`), citing real
lines in the seeded repo so the page and the e2e flow work with **no API key**.

### W5 — tests

| Suite | Covers |
|---|---|
| server-unit | `pickConfigFiles` allowlist; `numberLines`; `groundConventions` — missing file, out-of-range line, drifted snippet, duplicate rule, bad confidence; `mergeToSkillBody` markdown shape; route smoke with `MockLLMProvider({ structuredBySchema: { ConventionFileSelection, ConventionExtraction } })` |
| server-integration | `conventions.it.test.ts` — extract (mock LLM) → list → PATCH accept/reject/edit → `POST …/skill` → skill visible in `GET /skills`, `skill_id` stamped, agent link written |
| client | `ConventionCard` accept/reject/edit; `CreateSkillModal` merge + empty-body validation |
| e2e | `09-conventions.flow.json` on seeded rows — render, accept two, open modal, save, land on the skill. No model call. |

---

## 5. Part 3 — API Contract Reviewer (skills + experiment)

The agent, its prompt (`docs/agent-prompts/api-contract-reviewer.md`) and one
broad `api-contract-gate` skill already ship from the skills lesson. Remaining:

1. Split the broad gate into four directive skills, each with an explicit
   **good / bad** pair: `breaking-change`, `response-schema`,
   `semver-discipline`, `deprecation-policy`. Author as markdown under
   `docs/agent-prompts/skills/`.
2. Load **at least one through the UI import flow** (file import → preview →
   confirm; it lands `enabled: false` by design, so enable it explicitly); seed
   the others.
3. Link all four to the API Contract Reviewer in the agent's Skills tab, ordered
   breaking-change → response-schema → semver-discipline → deprecation-policy.
4. **Experiment.** Add a control PR to `seed-control-prs.ts` (next number after
   483/484) that renames a response field *and* makes a query param required.
   Run the agent twice — per-link `enabled: false` for all four, then `true` —
   and record both runs (findings, severities, verdict, cost) in
   `docs/features/conventions/experiment.md`. The per-link toggle is exactly the
   A/B mechanism `agent_skills.enabled` was added for.

---

## 6. Product improvements (quantity + quality of findings)

Ordered by payoff / effort. Items 1–2 are in W1 above; the rest are follow-ups.

1. **Category quota.** Ask for 1–3 rules per category across a fixed taxonomy
   (naming, error handling, module structure, async style, imports, validation,
   logging, testing) instead of "find conventions" — turns one vague ask into
   eight scoped ones and roughly triples the usable yield.
2. **Two-step selection** (call 1) — a cheap model reading paths + repo map picks
   better files than rank alone, and keeps call 2's context small.
3. **Corroboration ≥ 2.** Require two evidence sites per rule; confidence becomes
   a function of site count, not the model's self-report. One-off style is not a
   convention.
4. **Counter-example grep.** Run the rule's pattern through
   `container.codeIndex` (ripgrep): many violations → it is aspirational, not a
   house rule. Rank it down or label it `aspirational`.
5. **Learning loop.** Feed the last scan's *rejected* rules back into the
   extraction prompt as negative few-shots, and skip rules already covered by an
   enabled skill (the dedupe in step 4 is the hook).
6. **Mine review history.** `pulls` already stores review comments — recurring
   human comments ("we always use X here") are a convention source with real
   social proof, and unlike source files they say *why*.
7. **Keep the rejects.** A rejected candidate is training data and the raw
   material for the eval set; never hard-delete.

---

## 7. Risks

- `server/src/vendor/shared` and `client/src/vendor/shared` are **hand-copied**.
  Every `ConventionCandidate` edit must be applied to both — there is no script.
- `conventions.status` replaces `accepted`: the column is unused today, but it is
  still a generated migration + a contract change in two places.
- Extraction quality depends on `repo-intel` having indexed the repo. Unindexed
  → zero samples. Degrade to an empty `done` extraction with a visible reason;
  never throw, never leave `running` forever (the job handler must always write a
  terminal row, `failed` included).
- No linter in this repo — **typecheck + tests are the only gate**
  (`pnpm typecheck` in both packages, both vitest splits).
- Migrations do not run on boot: `pnpm db:migrate` is a manual step after W0.
