# Architecture review: tickets PR

Scope: `adapters/github/issues.ts`, `modules/tickets/{repository,service,routes}.ts`.
Reviewed against the onion-architecture skill, including the failure-path rule (`AppError` subclasses from `platform/errors.ts`, rendered by the single `setErrorHandler`).

Dependency direction is fine: `repository.ts` is the only file that imports Drizzle, `service.ts` has no SDK imports, and the Octokit import is confined to the adapter. The problems are all in the error contract.

## Problems

### 1. `routes.ts`: hand-built 404 body in `GET /tickets/:id`
`reply.code(404).send({ error: 'not_found' })`
- Why: routes must never build a 4xx/5xx body by hand. This returns `{ error: 'not_found' }` instead of the `{ error: { code, message, details } }` envelope the client depends on, so the same condition has two shapes. It also puts a branch in the transport layer.
- Fix: `service.get` throws `NotFoundError('Ticket not found')` when the repo returns null. The handler becomes `return service.get(req.params.id)`.

### 2. `routes.ts`: `try/catch` that remaps errors to statuses in `POST /tickets/:id/close`
Matches `err.message` strings (`'ticket_not_found'`, `'ticket_already_closed'`) and sends `{ error: message }` with 404/409.
- Why: the catch exists only to map an error to a status, which is the job of `app.setErrorHandler`. It couples transport to magic message strings, and it produces non-envelope bodies. Anything unmatched is rethrown as a bare `Error` and ends up as a generic 500.
- Fix: delete the `try/catch`. The handler is just `return service.close(req.params.id)`, and the error handler maps the thrown `AppError`s.

### 3. `service.ts`: bare `throw new Error(...)` (lines 18, 19, 23)
`'ticket_not_found'` (twice) and `'ticket_already_closed'`.
- Why: failures must be `AppError` subclasses. Bare `Error`s carry no code or status, which is why the route had to string-match them (problem 2).
- Fix:
  - Not found (both places): `throw new NotFoundError('Ticket not found')`.
  - Already closed: add a `ConflictError extends AppError` (code `conflict`, status 409) to `platform/errors.ts` and throw it. Do not reuse `ValidationError`, because that maps to 422 and would change the current 409 behaviour. `new AppError('ticket_already_closed', msg, 409)` is an acceptable stopgap.
  - The second not-found, after `setStatus`, is the same condition and gets the same error.

### 4. `service.ts`: `get()` returns `null` for a missing ticket
- Why: this pushes the not-found decision up into the route (problem 1). Absence is a failure path and belongs in the service.
- Fix: `async get(id): Promise<Ticket>` that throws `NotFoundError` when the repo returns null.

### 5. `adapters/github/issues.ts`: Octokit failure escapes unwrapped
`close()` awaits `octokit.rest.issues.update(...)` with no error handling.
- Why: an Octokit `RequestError` (404, 403, rate limit, network) leaks the vendor exception type into the application layer. It bypasses the 502 mapping, so an upstream outage surfaces as a generic 500 instead of the stable `external_service_error` envelope.
- Fix: wrap the call in `try/catch` and `throw new ExternalServiceError('GitHub issue close failed', { issueNumber, status: (e as {status?:number}).status })`. Keep the original cause in `details` or `cause`, but never rethrow the Octokit type.

## Smaller notes
- `close()` calls GitHub and then updates the DB, which is not atomic. If `setStatus` fails or returns null after the issue is already closed, the two systems disagree. This is not a layering violation, but consider ordering or compensation. The post-`setStatus` null check should become the `NotFoundError` from problem 3.
- Not verifiable from this server-only snapshot (`container.ts`, `shared/adapters.ts`, `adapters/mocks.ts` are not included): confirm that `IssueTracker` is declared as a port, that a mock exists in `adapters/mocks.ts`, and that it is registered in `container.ts` as `issues`. All four pieces must exist, not just the concrete adapter. Also confirm `OctokitIssueTracker`'s `(token, owner, repo)` constructor is built in the container, not in a service.
- `repository.ts` is fine. It maps `$inferSelect` rows to the shared `Ticket` before returning, and nothing Drizzle-typed escapes it.

## Verdict
Do not open as is. Problems 1-5 are one issue: the error contract is bypassed in every layer (route, service, adapter). After the fixes the route file contains no error handling at all.
