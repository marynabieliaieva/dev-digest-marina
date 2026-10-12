# Architecture review: orders PR

Verdict: no architecture problems found. Fine to merge from an architecture standpoint.

Files reviewed: orders/constants.ts, orders/repository.ts, orders/service.ts, orders/routes.ts. I also read customers/service.ts and customers/repository.ts for context.

## What I checked
- routes.ts only validates input with zod, calls the service and sets the status code. It has no DB access and no business rules.
- service.ts holds the business rules (item count limits, minimum total, customer blocked, shipped orders cannot be cancelled). It imports no drizzle, DB schema or SDK. It reaches the DB only through OrderRepository.
- repository.ts is the only orders file that touches drizzle and the schema. It maps rows to the shared `Order` type, so DB row types do not leak out.
- constants.ts is plain constants with no imports.
- The cross-module dependency goes through `CustomerService`, the customers module's public service. It does not import the customers repository or schema, so there is no module-boundary bypass.
- The dependency direction is routes -> service -> repository -> db. There are no cycles: customers does not import orders.

## Non-blocking notes (not architecture violations)
- `OrderService` builds `CustomerService` inline on each `place()` call. This is a small testability nit. Optionally build it once in the constructor, or take it from the container.
- The route schema allows any int for `itemCount` and `totalCents`. The service enforces the bounds, which is acceptable.

No fixes are required.
