# Architecture review: summaries module

Scope: `server/src/modules/summaries/*` and `server/src/vendor/shared/contracts/summary.ts`.

## Problems

### 1. Shared contract imports from a server module (inward dependency broken)
- File: `server/src/vendor/shared/contracts/summary.ts` (line 2, 19)
- Why wrong: `@devdigest/shared` is consumed by client, reviewer-core, mcp and e2e as well as the server. It must be a leaf: only zod and pure types. Importing `modules/summaries/helpers.js` makes the shared package depend on a server module (wrong direction, creates a cycle with `service.ts` -> `@devdigest/shared` -> `helpers.ts`), and drags server code into other packages' builds.
- Fix: Delete `cacheKeyFor` and the import from the contract; keep only the zod schemas and inferred types. If a cache key is needed outside the module, call `summaryCacheKey` from the module itself.

### 2. Service constructs the OpenAI SDK directly (no port)
- File: `server/src/modules/summaries/service.ts` (lines 1, 20-27)
- Why wrong: The application layer imports `openai` and does `new OpenAI(...)`, bypassing the DI container and any port/interface. It couples business logic to a vendor SDK, makes it untestable without network/mocking the module, and reads `process.env.OPENAI_API_KEY` directly in the service instead of via config. Also builds a new client on every call.
- Fix: Define an `LlmPort` / `SummaryGenerator` interface (e.g. `complete({model, system, user}): Promise<string>`), implement it in an infrastructure adapter (e.g. `platform/llm/openai-llm.ts`) that owns the SDK and env/config, register it on the `Container`, and have the service depend only on the port.

### 3. Route handler contains business logic and talks to the repository
- File: `server/src/modules/summaries/routes.ts` (lines 4, 9, 15-20)
- Why wrong: The transport layer instantiates `SummaryRepository` directly, bypassing the service, and implements the free-tier quota rule (start-of-day computation, plan check, limit comparison) inline. Business rules belong in the application layer; routes should only parse input, call the service, and map errors to HTTP codes.
- Fix: Move the quota check into `SummaryService` (throw a domain error such as `DailyLimitReachedError`), remove the repository from routes, and map the error to 429 in the route/error handler.

### 4. Route fetches from GitHub and applies domain validation itself
- File: `server/src/modules/summaries/routes.ts` (lines 22-25)
- Why wrong: Route calls `app.container.github` directly and decides the "empty diff" rule. Orchestration (fetch diff -> validate -> summarize) is application logic; the service's `summarize(userId, req, diff)` signature leaks that orchestration to the caller.
- Fix: Have the service accept only `(userId, req)`, obtain the diff via a GitHub port injected through the container, throw `EmptyDiffError`, and translate to 422 in the route.

### 5. Service depends on the whole Container and builds its own repository
- File: `server/src/modules/summaries/service.ts` (lines 3, 9-13)
- Why wrong: Service-locator style: `Container` gives access to everything, and `new SummaryRepository(container.db)` hard-wires the concrete Drizzle repository, so the service cannot be tested with a fake and depends on infrastructure. Routes also construct the service ad hoc (duplicate repo instances in routes and service).
- Fix: Inject only the needed collaborators via constructor (`SummaryRepository` interface/port, `LlmPort`, `GithubPort`, clock) and wire them once in the container/composition root.

### 6. Repository leaks persistence-shaped mapping and has no port; time-based rule inputs computed outside
- File: `server/src/modules/summaries/repository.ts`
- Why wrong: The repository is only a concrete class (no interface in the domain/application layer), and the row -> `Summary` mapping is duplicated in two methods. Returning the shared wire-contract type (`Summary`, with `createdAt` as ISO string) from the persistence layer ties storage to the API DTO.
- Fix: Declare a repository interface next to the service, add a single private `toDomain(row)` mapper, and keep DTO formatting (ISO strings) at the edge.

### 7. Cache lookup is not scoped to the user; caching key logic spread across layers
- File: `server/src/modules/summaries/service.ts` (lines 16-18), `repository.ts` (`findByKey`)
- Why wrong: `findByKey` ignores `userId`, while `insert`/`countSince` are per-user. A cached summary is returned to any user and a cached hit also bypasses nothing in quota, but note the route counts quota before the cache check, so cache hits consume quota. The key derivation also lives in `helpers.ts` yet is exported through the shared contract (see #1).
- Fix: Decide the intended semantics explicitly; keep key derivation private to the module, and order quota/cache checks in the service.

### 8. Model name and limits as hard-coded constants in the module
- File: `server/src/modules/summaries/constants.ts`
- Why wrong (minor): `SUMMARY_MODEL` ('gpt-4o-mini') is a vendor-specific infrastructure detail living in the domain/application module, reinforcing the SDK coupling. `FREE_TIER_DAILY_LIMIT` is fine as a domain rule.
- Fix: Move the model name to LLM adapter/config; keep the limit constant in the module (used by the service, not the route).

## Layering summary

| File | Current role | Should be |
|---|---|---|
| shared/contracts/summary.ts | contract, imports server helper | pure zod schemas only |
| routes.ts | transport + quota rules + repo + GitHub | parse, call service, map errors |
| service.ts | orchestration + OpenAI SDK + repo construction | orchestration over ports only |
| repository.ts | Drizzle adapter | adapter implementing a port |
| helpers.ts / constants.ts | pure | OK (model constant moves out) |
