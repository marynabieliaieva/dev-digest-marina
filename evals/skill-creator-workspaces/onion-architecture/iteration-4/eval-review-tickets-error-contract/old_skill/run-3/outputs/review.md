# Architecture review: tickets PR

Reviewed against the onion-architecture skill (dependency direction, layer placement, port/adapter wiring). Changed files: `adapters/github/issues.ts`, `modules/tickets/{repository,service,routes}.ts`. Snapshot is server-only.

Import direction is clean: `service.ts` imports no SDK or Drizzle, `routes.ts` imports only the service, `repository.ts` maps `$inferSelect` to the shared `Ticket` before returning, and only the adapter imports `octokit`. The problems are below.

## 1. Service throws bare `Error` with magic strings; the HTTP mapping lives in `routes.ts`
- Files: `server/src/modules/tickets/service.ts` (lines 18, 19, 23), `server/src/modules/tickets/routes.ts` (lines 8-9, 14-21)
- Why: The service signals business outcomes with `new Error('ticket_not_found')` and `new Error('ticket_already_closed')`. The route then parses `err.message` to pick a status (404/409). This is branching logic in the transport layer and a stringly-typed contract between layers. A renamed string silently turns a 409 into a 500. The repo already has a typed error contract in `server/src/platform/errors.ts` (`AppError`, `NotFoundError`, ...), which this PR bypasses. The `GET` handler also decides "null means 404" in the route.
- Fix: In `service.ts` throw `NotFoundError('Ticket not found')` for the missing case, including from `get()` (return `Ticket`, not `Ticket | null`). For "already closed" throw `new AppError('ticket_already_closed', 'Ticket already closed', 409)`, or add a `ConflictError` (409) to `platform/errors.ts` next to the others. Delete the try/catch and message matching in `routes.ts`; handlers become parse -> one service call -> return. The central Fastify error handler already maps `AppError.statusCode`/`code` to the response body.

## 2. The `IssueTracker` port and its wiring are not part of the PR
- Files: `server/src/adapters/github/issues.ts`, `server/src/modules/tickets/service.ts` (line 21, `this.container.issues.close`)
- Why: A new external integration needs all four pieces: the port in `@devdigest/shared/adapters.ts`, the implementation under `server/src/adapters/<name>/`, a mock in `adapters/mocks.ts`, and registration in `platform/container.ts` (with `ContainerOverrides`). The PR only contains the implementation. Nothing here shows `IssueTracker` exists in shared, that `Container` exposes `issues`, or that a mock exists, so the service may not compile and can't be unit-tested without hitting GitHub.
- Fix: Add the `IssueTracker` interface to `shared/adapters.ts`, an in-memory mock to `adapters/mocks.ts`, and `issues` to `container.ts` plus its overrides. Add them to the PR.

## 3. Adapter is bound to one owner/repo and a raw token
- File: `server/src/adapters/github/issues.ts` (lines 7-9)
- Why: `new OctokitIssueTracker(token, owner, repo)` hardcodes a single repository in a container-level singleton. A ticket belongs to some repo, but `close(issueNumber)` carries no repo context, so tickets from other repos would close the wrong issue. It also duplicates what the existing `GitHubClient` adapter already provides (auth, Octokit construction).
- Fix: Put the repo identity in the port call (`close(repo, issueNumber)`), or extend the existing `GitHubClient` port and adapter instead of adding a second Octokit wrapper. Build it from the container's secrets/auth providers, not a raw token argument.

## 4. Adapter leaks raw SDK errors
- File: `server/src/adapters/github/issues.ts` (lines 11-18)
- Why: Octokit `RequestError`s propagate out of the port unchanged, so the service and routes depend, implicitly, on the SDK's error shape. `platform/errors.ts` has `ExternalServiceError` for exactly this case.
- Fix: Catch in the adapter and rethrow `new ExternalServiceError('GitHub issue close failed', { cause })` (and map a 404 from GitHub appropriately).

## 5. Non-atomic cross-system orchestration in `close()`
- File: `server/src/modules/tickets/service.ts` (lines 21-22)
- Why: The GitHub issue is closed first, then the DB row is updated. If `setStatus` fails, GitHub is closed but the ticket still reads `open`, and a retry will hit the "already closed on GitHub" path with no handling. This is application-layer orchestration that needs an explicit policy. The final `if (!updated) throw` also means a race can leave the two systems divergent.
- Fix: Decide the order and failure policy in the service (for example, update the DB first and compensate, or make the adapter close idempotent so retry is safe), and cover it with a test using the mock port.

## 6. Minor / notes
- `TicketService` builds `new TicketRepository(container.db)`. This matches the repo's accepted convention (persistence is not yet inverted). If ticket queries grow, consider an `ITicketRepository` interface so the service can be tested against a mock.
- `routes.ts` instantiates the service at plugin registration, which is fine.

## Summary
Blocking: 1 (error contract in the wrong layer), 2 (missing port/mock/container wiring). Should fix: 3, 4, 5.
