# Onion architecture review: summaries module

Scope (repo root = `evals/fixtures/summaries-pr/`): `server/src/modules/summaries/{routes,service,repository,helpers,constants}.ts` and `server/src/vendor/shared/contracts/summary.ts`.
Checked against the onion-architecture skill (SKILL.md, layer-map.md, enforcement.md). Verdict: **do not send as is - 5 violations (3 critical, 2 major), 2 minor notes.**

## Critical

### 1. `service.ts` imports the `openai` SDK and constructs it inline
- File: `server/src/modules/summaries/service.ts` (line 1, lines 20-27)
- Why wrong: the application layer may depend only on ports, never on a concrete SDK. `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` inside `summarize()` also reads config from `process.env` in the middle of a business method. It cannot be swapped for a mock via `ContainerOverrides`, so the service cannot be unit-tested without hitting OpenAI. This is the main violation the skill exists to catch.
- Fix: delete the `openai` import and the `new OpenAI(...)` call. Use the existing `LLMProvider` port from `@devdigest/shared/adapters.ts`, taken from the container (e.g. `this.container.llm`), and call it with the system/user messages and `SUMMARY_MODEL`. The API key stays in the adapter and `container.ts` wiring, not in the service. If `LLMProvider` lacks a simple completion method, extend the port and its adapter and mock (`adapters/mocks.ts`); do not import the SDK here.

### 2. `routes.ts` reaches past the service into the repository
- File: `server/src/modules/summaries/routes.ts` (lines 4, 9, 17)
- Why wrong: transport may import only the module's `service.ts`. Importing `SummaryRepository` and passing it `app.container.db` makes the route handler a data-access client, so the layering is `routes -> repository -> db`, skipping the application layer.
- Fix: remove the `SummaryRepository` import and the `repo` instance from `routes.ts`. Move `countSince` usage into `SummaryService`.

### 3. Business logic written in `routes.ts` (quota, empty-diff rule, date math)
- File: `server/src/modules/summaries/routes.ts` (lines 15-25)
- Why wrong: the free-tier daily limit (`req.user.plan === 'free' && used >= FREE_TIER_DAILY_LIMIT`), the start-of-day computation and the empty-diff rule are business policy. A route must parse the request, call exactly one service method and map the result to status/body. As written, this logic can only be tested through Fastify `inject()`.
- Fix: move the quota check, the start-of-day calculation and the empty-diff check into `SummaryService.summarize` (pass the plan/user in). Have the service signal outcomes with typed domain errors or a result union (e.g. `DailyLimitReached`, `EmptyDiff`), and let the route only map those to 429/422. `FREE_TIER_DAILY_LIMIT` is then used only by the service.

## Major

### 4. `routes.ts` calls the GitHub client directly
- File: `server/src/modules/summaries/routes.ts` (line 22: `app.container.github.getPullRequestDiff`)
- Why wrong: the route orchestrates an adapter (fetch diff, then pass it to the service). Fetching the diff is an orchestration step that belongs in the application layer; the route also now needs to know the container's ports. `summarize(userId, req, diff)` has a signature shaped by this leak.
- Fix: have `SummaryService.summarize(user, req)` fetch the diff through `this.container.github` (the `GitHubClient` port) itself, then apply the empty-diff rule. The route becomes: parse body, call `service.summarize(...)`, map the result.

### 5. The domain contract imports from a module (inward layer depends outward)
- File: `server/src/vendor/shared/contracts/summary.ts` (line 2 import, line 19 `cacheKeyFor`)
- Why wrong: `@devdigest/shared/contracts/*` is the domain center and must not import anything from `server/src/modules/*` (shared-contracts-must-not-import-server-or-client rule). It creates a cycle (`helpers.ts` is reached via service, and the contract now depends on it) and breaks the contract's reuse by `client`, `reviewer-core` and `mcp`, which cannot resolve `../../../modules/summaries/helpers.js`. It also drags module code into the manually duplicated `client/src/vendor/shared` copy.
- Fix: delete the `import` and the `cacheKeyFor` export from the contract file; the contract should contain only the Zod schemas and inferred types. `summaryCacheKey` already lives in `helpers.ts`; if a caller needs a cache key from a `SummaryRequest`, call `summaryCacheKey(req.prId, req.maxWords)` from the service. If the contract change is kept in any form, copy it by hand to `client/src/vendor/shared`.

## Minor / notes

### 6. Repository has no port (known gap, not blocking)
- File: `server/src/modules/summaries/repository.ts`, `service.ts` line 12
- `new SummaryRepository(container.db)` matches the existing convention (`RepoRepository`), and the repository correctly maps rows to the shared `Summary` type, so no Drizzle `$inferSelect` type escapes. Per layer-map.md, flag rather than block: once quota/cache logic moves into the service (fixes 3 and 4), the service gets non-trivial logic, so consider an `ISummaryRepository` interface so it can be tested with a mock.
- Also: the row-to-`Summary` mapping is duplicated in `findByKey` and `insert`; extract a small `toSummaryDto(row)` (in `repository.ts` or `helpers.ts`).

### 7. Config read via `process.env` (covered by fix 1)
- `service.ts` line 20 reads `OPENAI_API_KEY` directly. After fix 1 this should live only in the LLM adapter/container wiring. The model name (`SUMMARY_MODEL`) and limits are fine in `constants.ts`.

## What is fine
- `repository.ts` is the only file importing `drizzle-orm` and `db/schema`, and returns the shared `Summary` type rather than raw rows.
- `helpers.ts` and `constants.ts` are pure (no I/O imports).
- Module file naming follows the role-based convention.

## Target shape after fixes
- `routes.ts`: parse `SummaryRequest`, call `SummaryService.summarize(...)`, map `DailyLimitReached` to 429, `EmptyDiff` to 422, success to the body. Imports only `service.js` and shared contracts.
- `service.ts`: imports only domain types, `Container`, repository, helpers, constants. Uses `container.github` (diff) and `container.llm` (completion) ports; owns the quota and empty-diff rules.
- `contracts/summary.ts`: Zod schemas and types only.
