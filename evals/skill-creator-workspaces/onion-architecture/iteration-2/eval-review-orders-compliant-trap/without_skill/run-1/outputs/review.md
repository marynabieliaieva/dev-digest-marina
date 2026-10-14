# Architecture review: orders PR

**Verdict: fine to merge from an architecture standpoint. No blocking problems found.**

Files reviewed: orders/constants.ts, repository.ts, service.ts, routes.ts (plus customers/service.ts and repository.ts for the cross-module call).

## What I checked
- **Layering (routes -> service -> repository):** routes.ts only parses the body with zod, calls `OrderService`, and shapes the HTTP response. It has no DB access and no business rules. service.ts holds the rules (item count, minimum total, blocked customer, shipped-order cancel) and imports no drizzle, Fastify, or SDK. repository.ts is the only orders file that touches drizzle and the schema.
- **Cross-module dependency:** orders reaches customers through `CustomerService`, not through `CustomerRepository` or the customers schema. That is the correct boundary.
- **Types at the boundary:** the repository maps rows to the shared `Order` contract through `toOrder`, so DB row types do not leak into the service.
- **Constants:** the business limits live in constants.ts, not inline.
- **Consistency:** the service builds its repository from `container.db`, the same pattern customers/service.ts uses.

## Non-blocking notes (optional)
- `OrderService` instantiates `CustomerService` inside `place()`. Constructing it once in the constructor, or taking it from the container, would be tidier and easier to test. This is not a boundary violation.
- The zod body schema in routes.ts does not enforce the item-count or minimum-total bounds. The service enforces them, which is acceptable, but route-level bounds would give earlier 400s.
- The service throws `ConflictError` and `NotFoundError` from platform/errors, which is fine as long as the error handler maps them to HTTP codes.

No file needs a required fix.
