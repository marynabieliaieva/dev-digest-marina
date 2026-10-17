# Architecture review: orders PR

**Verdict: no architecture problems. Fine to merge from an architecture standpoint.**

Files reviewed: `orders/constants.ts`, `orders/repository.ts`, `orders/service.ts`, `orders/routes.ts`. I also read `customers/service.ts` and `customers/repository.ts` to check the cross-module call.

## Checklist (onion-architecture enforcement.md)

1. **`service.ts` imports a concrete SDK or DB?** No. `orders/service.ts` imports only shared types, `Container`, the error classes, `CustomerService`, its own `OrderRepository` and `constants`. It has no `drizzle-orm`, `db/client` or `db/schema/*` import and no SDK.
2. **`routes.ts` reaches past the service?** No. It imports only `fastify`, `zod` and `./service.js`. Each handler parses the input and makes one service call (`place` or `cancel`). `201` is the only status mapping.
3. **Drizzle types in a service signature?** No. `OrderRow` (`$inferSelect`) stays inside `repository.ts` and is mapped by `toOrder()` to the shared `Order` type. The service signatures use `Order` only.
4. **Business logic in `routes.ts`?** No. The item-count and minimum-total checks, the customer-blocked check and the shipped-cancel rule are all in `service.ts`. The Zod body parse is boundary validation, which belongs in routes.
5. **New external integration?** None added, so no port, adapter or mock is needed.
6. **Domain depending outward?** No shared contract or `reviewer-core` file is changed.
7. **Repository interface?** `OrderRepository` is three simple queries. An interface is not needed now. It would only be worth adding if the queries become complex.

## Cross-module call

`OrderService.place` calls the customers module with `new CustomerService(this.container)`. This is the pattern the skill prescribes (decision order 6): construct the callee at the call site with the container. It does not reach into the customers repository or schema, and a container facade is not needed for a single caller.

## Other checks

- `repository.ts` is the only orders file that imports `drizzle-orm`, `db/client` and `db/schema`.
- `constants.ts` holds the literals, and the role-based file naming is followed.
- The service takes the whole `Container`, as in `ReviewService` and `RepoService`.

## Non-blocking notes (no action required)

- Like the existing modules, the repository has no port interface. This is a known, accepted gap in the repo.
- `place` builds a `CustomerService` on every call. This is cosmetic and could be moved to the constructor if you prefer.

No file, reason or fix entries are needed because there are no findings.
