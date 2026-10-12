# Architecture review: notifications module

Scope: `server/src/modules/notifications/` (constants, helpers, repository, routes, service).
Expected layering: routes -> service -> repository -> DB; external systems behind an adapter/port obtained from the DI container; domain/DTO types in shared contracts.

## Problems

### 1. Route handler queries the database directly (bypasses service and repository)
- File: `routes.ts`
- Offending: imports on lines 2, 4, 5 (`drizzle-orm`, `db` from `../../db/client.js`, `* as t from '../../db/schema/notifications.js'`) and the `/notifications/unread` handler (lines 15-23) running `db.select().from(t.notifications)...`.
- Why: The transport layer depends on the persistence layer and an ORM, skipping the application layer. Business logic (the unread filter) lives in the route, it can't be reused or unit-tested without a DB, and it returns raw rows (including `Date` objects and internal columns) rather than the `Notification` DTO, so the response shape differs from `/notifications`. It also uses the global `db` singleton instead of `app.container.db`, bypassing DI (breaks test substitution and any per-request/transaction wiring). The filter is applied in memory after fetching all rows, with no limit, which is unbounded.
- Fix: Add `NotificationRepository.listUnreadForUser(userId, limit)` with `and(eq(userId), isNull(readAt))` and a `limit`; add `NotificationService.listUnread(userId)` that maps through `toNotificationDto`; make the route just call `service.listUnread(req.user.id)`. Remove the drizzle and db/schema imports from `routes.ts`.

### 2. Service imports a third-party SDK (Octokit) directly
- File: `service.ts`
- Offending: line 1 `import { Octokit } from 'octokit';` and `syncFromGitHub` (lines 25-29) calling `new Octokit({ auth: token })`.
- Why: The application layer depends on a concrete external SDK and constructs it inline. This couples business logic to GitHub's client, makes it impossible to test without network or module mocking, and bypasses the project's adapter/port + DI container pattern (other modules get GitHub access through the container). The token is passed through the service API as a raw parameter too.
- Fix: Define a port (e.g. `GitHubNotificationsPort.listNotifications(userId)`) in the shared adapters contracts, implement it in `adapters/github/octokit.ts`, register it (and a mock in `adapters/mocks.ts`) in the container, and have the service use `this.container.github...`. The service only handles mapping/filtering.

### 3. `syncFromGitHub` is incomplete and misuses the channel constant
- File: `service.ts` (lines 25-29), `constants.ts`
- Offending: `n.reason !== DEFAULT_CHANNEL` and the unused `userId` parameter; result is only counted, never persisted.
- Why: `DEFAULT_CHANNEL` ('review') is a notification channel for stored rows, while `n.reason` is a GitHub reason string; comparing them conflates two domain concepts. The method has no persistence, so it doesn't "sync" anything, and `userId` is unused. This is a logic/design smell hidden by the SDK coupling.
- Fix: Map GitHub reasons to the domain channel in a helper/adapter, persist via the repository, and drop unused parameters.

### 4. Repository row type leaks out of the data layer into the service API
- File: `service.ts` (line 4 import `type NotificationRow`, lines 20-23 `getLatestRow`), `helpers.ts` (line 2)
- Offending: `getLatestRow(): Promise<NotificationRow | undefined>` returns a Drizzle-inferred row type from a public service method.
- Why: Callers of the service become coupled to the DB schema shape; the service should expose domain/DTO types (`Notification`), consistent with `list`. Any schema change ripples to consumers.
- Fix: Return `Notification | undefined` (map through `toNotificationDto`) or remove the method if unused.

### 5. Service constructs its own repository and depends on the whole Container
- File: `service.ts`
- Offending: `this.repo = new NotificationRepository(container.db);` and `constructor(private readonly container: Container)`; routes also do `new NotificationService(app.container)`.
- Why: Hard-wired concrete construction prevents injecting a fake repository in unit tests, and taking the entire container is a service-locator pattern that hides the real dependencies.
- Fix: Inject narrow dependencies (repository, and the GitHub port) into the service constructor and compose them in the container / module registration, or at minimum accept `{ db }` plus the specific port.

### 6. Helper depends on repository row type (minor)
- File: `helpers.ts`, line 2 `import type { NotificationRow } from './repository.js';`
- Why: Acceptable direction (type-only, same module), but it ties the mapper to the repository file; mapper is fine in `helpers.ts`. Consider exporting `NotificationRow` from a types file if more consumers appear. Low severity.

### 7. Route lacks input/output validation (minor, related)
- File: `routes.ts`, `/notifications/:id/read`
- Why: `req.params.id` is used unvalidated and no response schema is declared; combined with raw rows returned from `/unread`, response contracts are not enforced.
- Fix: Add Zod/JSON schemas using shared contracts for params and responses.

## Summary

Blocking: #1 (route -> db/drizzle bypass) and #2 (direct Octokit import in service). Should fix: #3, #4, #5. Minor: #6, #7. The repository itself and the DTO mapper are otherwise cleanly placed.
