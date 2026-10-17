# Architecture review: tickets PR

Scope: the 4 changed files (adapters/github/issues.ts, tickets/repository.ts, tickets/service.ts, tickets/routes.ts), checked against the onion-architecture skill. Dependency direction is clean: routes -> service -> repository, with the SDK only in the adapter. The problems are all in the error contract (failure paths must be `AppError` subclasses from `platform/errors.ts`, rendered by the single `setErrorHandler` in `app.ts`).

## Problems

### 1. `server/src/modules/tickets/routes.ts` - hand-built 404 body in GET /tickets/:id
`if (!ticket) return reply.code(404).send({ error: 'not_found' })`
- Why: routes build a 4xx body by hand. It skips the `{ error: { code, message, details } }` envelope the client depends on, and it puts the "missing resource" decision in the transport layer.
- Fix: drop the null check. Make `TicketService.get` throw `new NotFoundError('Ticket not found')` and have the route just `return service.get(req.params.id)`.

### 2. `server/src/modules/tickets/routes.ts` - try/catch that remaps errors to statuses in POST /tickets/:id/close
The handler catches, string-matches `err.message` (`'ticket_not_found'`, `'ticket_already_closed'`), and maps to 404/409 with ad-hoc `{ error: message }` bodies.
- Why: a catch used only to remap an error is an anti-pattern. It is brittle (string-matching messages), the response shape is not the standard envelope, and the status mapping is business knowledge sitting in the transport layer. Any other error is rethrown, so the contract is inconsistent.
- Fix: remove the try/catch. The route calls `service.close(id)` and returns the result. The service throws typed `AppError`s, and the global error handler picks the status.

### 3. `server/src/modules/tickets/service.ts` - bare `throw new Error(...)` (3 places)
`throw new Error('ticket_not_found')` (twice) and `throw new Error('ticket_already_closed')`.
- Why: bare `Error`s carry no code or status, which is what forced the string-matching in the route. Through the central handler they would become opaque 500s.
- Fix: `throw new NotFoundError('Ticket not found')` for both not-found cases. For already-closed, use a proper `AppError` subclass. `errors.ts` has no 409 class, so either add a `ConflictError` (code `conflict`, status 409) to `platform/errors.ts` to keep the current 409 behaviour, or use `ValidationError` (422) and accept the status change. Do not use a raw `{ statusCode }` object.

### 4. `server/src/adapters/github/issues.ts` - vendor exception escapes the adapter
`OctokitIssueTracker.close` awaits `octokit.rest.issues.update(...)` with no error handling.
- Why: an Octokit `RequestError` (404/403/rate limit/network) leaks into the application layer, so the SDK type crosses the port boundary and the failure bypasses the 502 mapping (it would surface as a 500 or a wrong status).
- Fix: wrap the call in try/catch and `throw new ExternalServiceError('Failed to close GitHub issue #N', { cause/status })`, so `service.close` and the handler see only `AppError`s.

## Verified OK (no action)
- `service.ts` imports no SDK or Drizzle. It uses the `IssueTracker` port via `container.issues` and builds its own `TicketRepository(container.db)`, matching the repo convention.
- `repository.ts` imports Drizzle and `db/schema` only here, and maps `$inferSelect` rows to the shared `Ticket` type (`toTicket`) before returning, so no Drizzle type leaks to the service.
- `adapters/github/issues.ts` is the only file importing `octokit` and implements the shared `IssueTracker` port.

## Notes / not verifiable from this snapshot
- Confirm the new port is complete: `IssueTracker` in `shared/adapters.ts`, a mock in `adapters/mocks.ts`, and registration (an `issues` getter plus `ContainerOverrides`) in `platform/container.ts`. The snapshot is server-only and does not include those files, so I could not check them. The checklist requires all four, not just the adapter.
- Low priority: the repository has no interface (the known, accepted persistence gap). It is small here, so fine.
- Low priority, not layering: in `close`, the GitHub issue is closed before the DB update. If the DB write fails, the two are out of sync. Worth a thought but outside this review's scope.
