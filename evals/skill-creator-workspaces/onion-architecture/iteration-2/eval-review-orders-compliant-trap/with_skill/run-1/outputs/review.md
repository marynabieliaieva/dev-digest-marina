# Architecture review: orders PR

Verdict: **No architecture problems found. Fine to merge from an architecture standpoint.**

Files reviewed: `orders/constants.ts`, `orders/repository.ts`, `orders/service.ts`, `orders/routes.ts`. I also read `customers/service.ts` and `customers/repository.ts`, because `OrderService` calls into them.

## Checklist results

1. **`service.ts` importing an SDK or db wrapper:** pass. `orders/service.ts` imports only shared types, `Container`, platform errors, `CustomerService`, its own `OrderRepository` and `constants`. There is no `drizzle-orm`, `db/client` or `db/schema/*` import, and there are no Drizzle `$inferSelect` types in its signatures. It only reads `container.db` to hand to its own repository, which matches the existing `service.ts` convention (`customers/service.ts` does the same).
2. **`routes.ts` reaching past the service:** pass. It imports only `fastify`, `zod` and `OrderService`. Each handler parses the body and calls exactly one service method. The status code (201) is mapped in the route. There is no business branching in the route.
3. **Drizzle types in service signatures:** pass. `place` and `cancel` return the shared `Order` type.
4. **Business logic in `routes.ts`:** pass. The item-count and minimum-total rules live in `service.ts`, and the limits live in `constants.ts`. The route only does Zod shape validation.
5. **New external integration:** not applicable. The PR adds no SDK or API client, so no port, adapter or mock is needed.
6. **Domain layer depending outward:** not applicable. The PR touches no shared contracts or `reviewer-core`.
7. **Repository growth:** pass. `OrderRepository` is small and does simple CRUD.

## Points checked that look like violations but are not

- **`OrderService` creating `new CustomerService(this.container)` in `place()`:** this is the sanctioned cross-module pattern ("call into another module's service means instantiating the callee at the call site with the container"). A container-level facade is reserved for subsystems with several consumers, and this has a single caller. It also goes through `CustomerService.get`, not the customers repository, so the module boundary is respected.
- **`OrderRepository` importing `drizzle-orm`, `db/client` and `db/schema/orders`:** this is allowed in `repository.ts`, which is the one place that may use them.
- **`OrderRepository` returning mapped `Order` objects:** the `toOrder` mapper converts the row to the shared type inside the repository, as the layer map requires. Rows never leak outward.
- **`OrderService` taking the whole `Container` in its constructor:** this is the required convention.
- **`constants.ts`:** pure values with no imports.
- **`orders/` having no `helpers.ts`:** optional, and nothing needs one.

## Findings

None. No file needs a change for architecture reasons.

## Out of scope (not architecture, optional)

- `PlaceOrderBody` has no `.min`/`.positive` bounds. The service enforces the real limits, so this is fine layering-wise.
- `customerId: z.string()` is not a uuid check. That is a validation nicety, not a layering concern.
