# Architecture review: tickets PR

Files reviewed: `server/src/adapters/github/issues.ts`, `server/src/modules/tickets/{repository,service,routes}.ts`, checked against `server/src/platform/errors.ts`.

Layering is mostly right. `repository.ts` is the only file importing Drizzle and it maps rows to the shared `Ticket` type. `service.ts` imports no SDK and reaches GitHub through `container.issues`. `routes.ts` calls the service. The Octokit import sits only in the adapter. The problems are all about the **error contract**, plus one wiring item to verify.

## Problems

### 1. `routes.ts` builds a 404 body by hand (GET /tickets/:id)
- File: `server/src/modules/tickets/routes.ts` line 9: `reply.code(404).send({ error: 'not_found' })`
- Why: Failures must be `AppError` subclasses rendered by the single `setErrorHandler` in `app.ts` as `{ error: { code, message, details } }`. This body is `{ error: 'not_found' }`, a string instead of the envelope, so the client sees two different error shapes.
- Fix: `service.get()` should throw `NotFoundError('Ticket not found')` and return `Promise<Ticket>`. The route becomes `return service.get(req.params.id)`.

### 2. `routes.ts` catches errors only to remap them to status codes (POST /tickets/:id/close)
- File: `server/src/modules/tickets/routes.ts` lines 13-22
- Why: The try/catch compares `err.message` strings (`'ticket_not_found'`, `'ticket_already_closed'`) and sends hand-built `{ error: message }` bodies with 404/409. This is the status mapping the central error handler exists for. It skips the envelope, is fragile (string matching), and puts error policy in the transport layer.
- Fix: Delete the try/catch. The route should be `return service.close(req.params.id)` and let `AppError`s propagate.

### 3. `service.ts` throws bare `Error` with magic strings
- File: `server/src/modules/tickets/service.ts` lines 18, 19, 23
- Why: Bare `Error` carries no status or code. It is the root cause of problems 1 and 2, because the route has to decode the message. Unhandled, these become 500s.
- Fix:
  - Line 18 and line 23: `throw new NotFoundError('Ticket not found')`.
  - Line 19: needs a 409. `errors.ts` has no conflict class, so add `ConflictError` (`code: 'conflict'`, status 409) to `server/src/platform/errors.ts` and throw `new ConflictError('Ticket already closed')`. Using `ValidationError` (422) would change the status the route returns today.
  - The second `not_found` check on line 23 (after `setStatus`) is a race case. It is also a `NotFoundError`.

### 4. Adapter lets the vendor exception escape
- File: `server/src/adapters/github/issues.ts` lines 11-18 (`close`)
- Why: `octokit.rest.issues.update` can throw an Octokit `RequestError` (404, 403, rate limit, network). It propagates through `service.close` as a raw vendor type, leaking Octokit into the application layer and bypassing the 502 mapping. The user gets a 500 instead of a clear upstream failure.
- Fix: Wrap the call in try/catch and throw `new ExternalServiceError('Failed to close GitHub issue', { issueNumber, cause })`. Do not rethrow the Octokit error.

### 5. Verify the `IssueTracker` port is fully wired (not visible in this PR)
- Files: `server/src/modules/tickets/service.ts` line 21 (`this.container.issues`), `server/src/adapters/github/issues.ts`
- Why: A new integration needs four pieces: the port in `@devdigest/shared/adapters.ts`, the implementation in `server/src/adapters/<name>/`, a mock in `server/src/adapters/mocks.ts`, and a registration in `platform/container.ts` (with a `ContainerOverrides` entry). `CHANGED.txt` lists only the implementation, so the port, mock and container wiring are either missing from the PR or sit outside it. If `container.issues` or the mock is missing, this does not compile or cannot be tested without hitting GitHub. Also, `OctokitIssueTracker` takes `token, owner, repo` in its constructor, so the container must supply these without the service ever touching them.
- Fix: Confirm all four exist. Add whichever are missing to the PR.

## Minor / advisory
- **Persistence not inverted**: `service.ts` does `new TicketRepository(container.db)` with no repository interface. This is the repo's accepted gap, so it is not blocking. Consider an interface if the repository logic grows.
- **Ordering in `close`**: GitHub is closed before the DB update. If `setStatus` fails, the issue is closed upstream but the ticket stays open. Consider the order or a retry/compensation, though this is a design point rather than a layering violation.

## Verdict
Fix items 1-4 before opening the PR (all are the same root issue: the error contract is bypassed). Confirm item 5. Once errors are `AppError`s, `routes.ts` is a thin pass-through, which is the target shape.
