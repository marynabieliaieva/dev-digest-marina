# Architecture review: orders PR

**Verdict: no architecture problems. Fine to merge from an architecture standpoint.**

Reviewed against the Onion Architecture checklist (enforcement.md). Changed files: `orders/constants.ts`, `repository.ts`, `service.ts`, `routes.ts`. `customers/service.ts` and `customers/repository.ts` are unchanged but were read, because orders calls into them.

## Checklist results

| # | Check | Result |
|---|---|---|
| 1 | `service.ts` imports a concrete SDK or `db/*`? | No. `orders/service.ts` imports only shared types, `Container`, platform errors, `CustomerService`, its own repository and constants. |
| 2 | `routes.ts` reaches past the service? | No. `orders/routes.ts` imports only Fastify, zod and `OrderService`. Each handler parses the body and calls one service method. |
| 3 | Drizzle `$inferSelect`/`$inferInsert` in a service signature? | No. `OrderRow` stays inside `repository.ts` and is mapped by `toOrder()` to the shared `Order` type. The repository's public methods return `Order`, not the row type. |
| 4 | Business logic in `routes.ts`? | No. Item-count and minimum-total validation, the blocked-customer check and the shipped-order check are all in `service.ts`. |
| 5 | New external integration without a port? | Not applicable. No SDK or new integration is added. |
| 6 | Domain/contracts importing outward? | Not applicable. No contracts changed. |
| 7 | Repository complexity | Three trivial queries, so an interface is not warranted. |

## Cross-module call

`OrderService.place` does `new CustomerService(this.container)` at the call site. This is the sanctioned pattern (decision order, item 6): there is a single caller, so no container facade is needed. It uses the callee's service, not the customers repository or schema, so no layer is skipped. `OrderService` also takes the whole `Container`, as the convention requires.

## Layer placement

- `constants.ts` holds literals only.
- `repository.ts` is the only orders file that imports `drizzle-orm`, `db/client` and `db/schema/*`, which is allowed for infrastructure.
- Files are named by role, as the repo convention requires.

## Non-blocking note (not a violation)

Orders has no repository interface. This is the known repo-wide gap (persistence is not inverted), and the repository here is small. If it grows complex query logic, consider an `IOrderRepository`.

No changes required.
