# Architecture review: `notifications` module

Scope: `server/src/modules/notifications/` (constants.ts, helpers.ts, repository.ts, routes.ts, service.ts).
Rules applied: onion-architecture skill (SKILL.md, layer-map.md, enforcement.md, examples.md).

Verdict: **do not merge as is.** 3 blocking violations, 2 non-blocking notes. `constants.ts`, `helpers.ts` and `repository.ts` are otherwise layered correctly.

## Blocking

### 1. `service.ts` imports and constructs the Octokit SDK directly
- File: `service.ts`
- Lines: `import { Octokit } from 'octokit';` (line 1) and `const octokit = new Octokit({ auth: token });` (line 26, in `syncFromGitHub`).
- Why: the Application layer may depend only on domain types and ports, never on a concrete SDK. This is the single most common onion violation. `new Octokit` inside the service can't be swapped for a mock through `ContainerOverrides`, so `syncFromGitHub` can't be unit-tested without the network. It also bypasses the container's secret handling: the caller has to pass a raw `token` string around.
- Fix: delete the `octokit` import. Get the existing `GitHubClient` port from the container (`const gh = await this.container.github()`, same as other services) and call it. If the port lacks a "list notifications" method, add it to `GitHubClient` in `@devdigest/shared/adapters.ts`, implement it in `server/src/adapters/github/`, and add it to the mock in `server/src/adapters/mocks.ts`. Drop the `token` parameter. `userId` is also unused in that method, so drop it or use it.

### 2. `routes.ts` queries the database directly, skipping service and repository
- File: `routes.ts`
- Offending imports: `import { desc, eq } from 'drizzle-orm';` (line 2), `import { db } from '../../db/client.js';` (line 4), `import * as t from '../../db/schema/notifications.js';` (line 5).
- Offending code: the `GET /notifications/unread` handler (lines 15-23) runs `db.select().from(t.notifications).where(...).orderBy(...)` itself.
- Why: the Interface layer may import only the module's `service.ts`. Reaching `db/client.js` and `db/schema/*` is the same violation as importing `drizzle-orm`. The handler duplicates `NotificationRepository.listForUser`. It also holds business logic (the `readAt === null` "unread" rule, applied with `.filter` after fetching every row), which can't be unit-tested without Fastify `inject()`. Because the handler skips `toNotificationDto`, it returns raw `$inferSelect` rows, so the DB column shape leaks to API clients and the response differs from `GET /notifications`.
- Fix: remove the three imports. Add `NotificationRepository.listUnreadForUser(userId, limit)` that filters in SQL (`and(eq(userId), isNull(readAt))`, with `desc(createdAt)` and a limit). Add `NotificationService.listUnread(userId)` that maps rows with `toNotificationDto` and returns `Notification[]`. The handler becomes `return service.listUnread(req.user.id)`. `routes.ts` should then import only `fastify` and `./service.js`.

### 3. `service.getLatestRow` leaks a Drizzle row type through the service's public API
- File: `service.ts`
- Offending lines: `import { NotificationRepository, type NotificationRow } from './repository.js';` (line 4) and `async getLatestRow(...): Promise<NotificationRow | undefined>` (line 20).
- Why: `NotificationRow` is `typeof t.notifications.$inferSelect`. The raw row type may exist at the repository-to-service seam, but a public service method must return a shared/domain type (the repos module maps through `toRepoDto` before returning). Any caller of `getLatestRow`, including other modules, is now coupled to the database schema.
- Fix: return `Promise<Notification | undefined>` and map with `toNotificationDto` (`return rows[0] ? toNotificationDto(rows[0]) : undefined`). Rename it `getLatest`. Then `service.ts` no longer needs the `NotificationRow` import.

## Non-blocking notes

### 4. No repository interface for a new module (advisory)
- File: `service.ts` line 12: `this.repo = new NotificationRepository(container.db);`
- Why: matches the existing repos/reviews pattern, which is an accepted gap. The notifications repository is small today, so this is not a violation. The skill asks reviewers to flag rather than silently copy it, and to consider an `INotificationRepository` if the query logic grows (it will with `listUnreadForUser`).
- Fix: optional. Introduce an interface so the service can be tested with a mock repository.

### 5. `DEFAULT_CHANNEL` used as an unrelated filter value
- File: `service.ts` line 28: `n.reason !== DEFAULT_CHANNEL`; constant defined in `constants.ts` line 2 as `'review'`.
- Why: not a layering issue, but it compares a GitHub notification `reason` to the module's internal channel name, so two unrelated concepts share one constant. This is a correctness smell and will surface when fixing #1.
- Fix: when moving the GitHub call behind the port, define an explicit constant for the reason you want to exclude, or map GitHub notifications to the module's domain type inside the adapter.

## What is correct
- `repository.ts`: the only file besides routes that touches Drizzle, and it is allowed to. It returns `NotificationRow`, which `helpers.ts` maps to the shared `Notification`.
- `helpers.ts`: pure mapping, imports only shared types and a type from the repository.
- `constants.ts`: literals only.
- `service.ts` takes the whole `Container` in its constructor, as `ReviewService` and `RepoService` do.

## Checklist result
1. `service.ts` imports a concrete SDK: **fail** (#1)
2. `routes.ts` reaches past the service into the db: **fail** (#2)
3. Service signature exposes `$inferSelect`: **fail** (#3)
4. Business logic in `routes.ts`: **fail** (#2, the unread filter)
5. New integration has port, adapter, mock and container wiring: **fail** (#1, none exists for GitHub notifications)
6. Domain imports outward: pass
7. Repository interface considered: advisory (#4)
