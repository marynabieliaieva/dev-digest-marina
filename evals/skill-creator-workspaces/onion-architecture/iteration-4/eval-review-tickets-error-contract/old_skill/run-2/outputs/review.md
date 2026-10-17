# Architecture review: tickets PR

Files reviewed: `adapters/github/issues.ts`, `modules/tickets/{repository,service,routes}.ts`. I also read `platform/errors.ts` as context, since it defines the existing error contract.

## Verdict
No dependency-direction violations in the layering itself. There is one real problem (error contract) and a few smaller ones, including missing wiring.

## Problems

### 1. Error contract: service throws bare `Error` with magic strings, and routes.ts decodes them (high)
**Files:** `server/src/modules/tickets/service.ts` (lines 18, 19, 23), `server/src/modules/tickets/routes.ts` (lines 14-21)

**Why:**
- The service signals failures with `new Error('ticket_not_found')` and `new Error('ticket_already_closed')`. `routes.ts` then compares `err.message` strings and picks the HTTP status (404/409).
- The repo already has a typed error contract in `platform/errors.ts` (`AppError`, `NotFoundError`, ...) that carries `code` and `statusCode`. This PR ignores it.
- The status mapping and business-error semantics are therefore duplicated in the transport layer, and the string coupling between the two files is invisible to the compiler. Renaming a message silently turns a 404/409 into a 500.
- `routes.ts` also holds branching on business outcomes. That is the wrong layer, because transport should only map.
- The routes catch is also inconsistent: the GET handler returns its own `{error:'not_found'}` body, while close uses a different path.
- There is no `ConflictError` for the "already closed" case (409). `AppError` defaults to 400.

**Fix:**
- In `service.ts`, throw `NotFoundError('Ticket not found')`, and add a `ConflictError` (`AppError('conflict', msg, 409)`) in `platform/errors.ts` for the already-closed case.
- Make `get()` throw `NotFoundError` too, or keep null and have the service decide.
- Delete the try/catch in `routes.ts` and let the central Fastify error handler translate `AppError`. If no handler exists, register one once rather than per route.

### 2. Close is not atomic: external side effect before DB write, with no failure handling (medium)
**File:** `server/src/modules/tickets/service.ts` (lines 21-23)

**Why:**
- The GitHub issue is closed first, then the DB status is updated. If `setStatus` fails or returns null, GitHub is closed but the local ticket remains open. Retrying then calls GitHub again.
- Octokit failures bubble up as raw errors (500) instead of `ExternalServiceError` (502).

**Fix:**
- Wrap the adapter call and translate failures to `ExternalServiceError`.
- Decide on an order and a compensation or idempotency strategy. For example, treat an already-closed GitHub issue as success. Closing is idempotent on GitHub, so retries are safe.

### 3. The `container.issues` port wiring is not in this PR (medium)
**Files:** `server/src/modules/tickets/service.ts` (line 21), `server/src/adapters/github/issues.ts`

**Why:**
- The service uses `this.container.issues`, but the changed files include no `Container` registration. There is also no `IssueTracker` port definition in `vendor/shared/adapters.ts` and no mock in `adapters/mocks.ts`.
- The skill requires all four pieces: port, concrete adapter, mock, container registration. Without the mock, the service cannot be unit-tested through `ContainerOverrides`.
- The `OctokitIssueTracker` constructor takes `(token, owner, repo)`, so it is bound to one repository at construction. The container cannot build it per ticket, so it will only work for a single fixed repo.

**Fix:**
- Add the `IssueTracker` port to `vendor/shared/adapters.ts`, a mock in `adapters/mocks.ts`, and the registration in `platform/container.ts`.
- Pass `owner` and `repo` as arguments to `close()`, or resolve them from the ticket.

### 4. Persistence has no port (low, known gap)
**File:** `server/src/modules/tickets/service.ts` (line 9)

`new TicketRepository(container.db)` is un-inverted, which matches the existing repo pattern and is acceptable. Consider an interface for the repository so `close()` can be tested with a mock. The class has real branching logic.

## Checked and fine
- `routes.ts` imports no Drizzle or SDK and calls one service method per handler.
- `service.ts` imports no SDK or `db/*`. It uses a port via the container and returns the shared `Ticket` type.
- `repository.ts` maps `$inferSelect` to the shared `Ticket` before returning, so no row type leaks.
- `adapters/github/issues.ts` is the only file that imports `octokit`.
