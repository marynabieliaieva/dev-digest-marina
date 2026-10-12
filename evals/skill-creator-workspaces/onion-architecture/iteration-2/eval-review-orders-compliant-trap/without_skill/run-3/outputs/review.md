# Architecture review: orders PR

Files reviewed: orders/constants.ts, orders/repository.ts, orders/service.ts, orders/routes.ts
(plus customers/service.ts and customers/repository.ts for context, not changed).

## Verdict: fine to merge from an architecture standpoint

I found no architecture problems.

## What I checked
- **Layering.** routes.ts only parses input (zod) and calls OrderService, with no DB or SDK access.
  service.ts holds the business rules (item-count and minimum-total limits, blocked customer,
  cannot cancel a shipped order) and talks to persistence only through OrderRepository.
  repository.ts is the only file importing drizzle-orm and the DB schema, and it maps rows to the
  shared `Order` type, so DB row shapes do not leak upward.
- **Cross-module access.** orders/service.ts uses `CustomerService` (the customers module's public
  service), not the customers repository or schema. That is the right seam.
- **Dependency direction.** No upward imports (repository does not import service or routes;
  service does not import routes). No circular dependency between orders and customers
  (customers does not import orders).
- **Naming and structure.** Files follow the role-based convention (routes/service/repository/constants).
  Constants are separated from logic.
- **External SDKs.** None imported in the service layer.

## Non-blocking nits (optional, not architecture violations)
- `orders/service.ts:23` creates `new CustomerService(this.container)` on each `place()` call. It
  works, but building it once in the constructor (or resolving it from the container) is tidier and
  easier to stub in tests.
- `orders/routes.ts:5-9` validates `itemCount` and `totalCents` only as integers. The range rules
  live in the service, which is the right place for business rules, so this is fine as is.
