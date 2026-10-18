# Architecture review: tickets PR

Scope: `adapters/github/issues.ts`, `modules/tickets/{repository,service,routes}.ts` (snapshot is server-only; `shared/adapters.ts`, `container.ts`, `mocks.ts` and the error handler are not in it).

## Problems

### 1. `service.ts` throws bare `Error` with magic string codes (error contract bypassed)
File: `server/src/modules/tickets/service.ts` (lines 18, 19, 23)
- Why: `platform/errors.ts` already defines the app's error contract (`AppError`, `NotFoundError`, `ValidationError`, `ExternalServiceError` carrying `code` + `statusCode`). The service ignores it and signals domain failures with `new Error('ticket_not_found')` / `'ticket_already_closed'`. The meaning of the failure is encoded in a string that an outer layer must know about and re-parse. Anything not caught that way falls to the generic 500 path.
- Fix: throw `new NotFoundError('Ticket not found')` and `new AppError('ticket_already_closed', 'Ticket already closed', 409)` (or add a `ConflictError extends AppError` in `platform/errors.ts`). Let the global Fastify error handler render them.

### 2. `routes.ts` contains error-mapping logic via string matching (transport doing the service's job)
File: `server/src/modules/tickets/routes.ts` (the `/tickets/:id/close` try/catch, lines 14-21; also the `if (!ticket)` 404 in the GET handler, line 9)
- Why: A route handler must parse, call exactly one service method, and map the result. Here it branches on `err.message` strings to choose 404 vs 409 and hand-builds `{ error }` bodies, duplicating the status knowledge in two places (service string + route if-chain) and diverging from the shape the shared error handler produces. Every new failure mode requires editing both files; a rename of a string silently turns a 409 into a 500. The GET handler also decides "missing means 404" itself.
- Fix: after fix 1 the close handler becomes `return service.close(req.params.id)` with no try/catch. Make `service.get` throw `NotFoundError` instead of returning `null`, and have the GET handler simply `return service.get(id)`.

### 3. New external integration is only partly delivered (port / mock / container wiring not in the PR)
Files: `server/src/adapters/github/issues.ts`, `server/src/modules/tickets/service.ts` (uses `this.container.issues`)
- Why: A new integration needs all four pieces: port in `@devdigest/shared/adapters.ts`, concrete adapter, mock in `adapters/mocks.ts`, registration in `platform/container.ts` (with `ContainerOverrides`). `CHANGED.txt` lists only the concrete adapter. The service relies on `container.issues` and the `IssueTracker` type, so either those exist outside this PR (verify) or the PR is incomplete. Without a mock and override, `TicketService.close` cannot be unit-tested without hitting GitHub.
- Fix: confirm `IssueTracker` is declared in `shared/adapters.ts`, add `MockIssueTracker` to `adapters/mocks.ts`, register the adapter and an `issues` getter/override in `container.ts`. Do not merge without them.

### 4. Adapter bound to a single owner/repo and leaks raw SDK failures
File: `server/src/adapters/github/issues.ts`
- Why: The constructor fixes `owner`/`repo`, so one adapter instance can only close issues in one repository, while `close(issueNumber)` on the port carries no repo. For a container-level singleton this is either wrong for multi-repo use or forces the service to know which repo (it currently cannot). Octokit errors propagate raw rather than as `ExternalServiceError`, so the transport layer would surface a 500 for what is a 502 upstream failure.
- Fix: put the repo identity in the port call (e.g. `close({ owner, repo, issueNumber })` or a `Ticket`-carried repo reference) and wrap SDK errors in `ExternalServiceError` inside the adapter.

### 5. Non-atomic orchestration: external side effect before persistence, no compensation
File: `server/src/modules/tickets/service.ts` (`close`, lines 21-23)
- Why: The GitHub issue is closed, then the DB update runs. If `setStatus` fails or returns null (line 23 throws not_found after the issue is already closed), GitHub and local state diverge and a retry hits `ticket_already_closed`-style confusion. This is an application-layer orchestration concern that belongs in `service.ts` to handle deliberately.
- Fix: decide the order and failure policy explicitly (e.g. update DB status first/inside a transaction and close the issue after, with a retry or compensating step), and do not report `not_found` after the external call has already succeeded.

## Reviewed, no violation
- `repository.ts`: only file importing `drizzle-orm`/`db/*`; maps `$inferSelect` row to the shared `Ticket` before returning. Correct seam.
- `service.ts` imports: no SDK, no drizzle, no `db/*`; depends on the `Container` and the port. Correct.
- `service.ts` does `new TicketRepository(container.db)`: matches the repo convention. Known gap (persistence has no port); not blocking, consider an interface only if repository logic grows.
- `routes.ts` imports: only `service.js` and Fastify types. Correct.
- `adapters/github/issues.ts`: the SDK import (`octokit`) is confined to the adapter, as required.

## Blocking summary
Fix before opening the PR: #1 and #2 (error contract), #3 (port/mock/container). #4 and #5 should be addressed or consciously deferred.
