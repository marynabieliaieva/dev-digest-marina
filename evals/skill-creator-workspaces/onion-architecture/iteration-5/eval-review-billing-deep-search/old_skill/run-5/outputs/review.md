# Architecture review: billing PR (onion-architecture)

Scope: the 9 files in CHANGED.txt, plus unchanged files they touch (`customers/repository.ts`, `notifications/*`, `platform/container.ts`), read for context. Rules applied: Dependency Rule, layer map, enforcement checklist.

Verdict: **do not open yet.** 8 problems, 4 of them blocking.

## Blocking

### 1. `server/src/modules/billing/service.ts` (line 4) and `server/src/lib/payments.ts` - Stripe SDK used with no port
- **Why:** `service.ts` calls `stripe.invoices.create(...)` on a module-level `new Stripe(...)` singleton from `lib/payments.ts`. `lib/payments.ts` is a local wrapper that re-exports the forbidden SDK, so it is the same violation as importing `stripe` in `service.ts`. This is a new external integration with none of the four required pieces: no port in `shared/adapters.ts`, no implementation under `server/src/adapters/`, no mock in `adapters/mocks.ts`, and no registration in `container.ts` (the snapshot `Container` exposes only `db`). The key is read from `process.env` at import time, so the service cannot be tested without hitting Stripe or mocking the module.
- **Fix:**
  1. Define a `PaymentProvider` port (`createInvoice({ customerExternalId, description })`) in `shared/adapters.ts`.
  2. Move the Stripe code to `server/src/adapters/payments/stripe.ts`, the only file that imports `stripe`.
  3. Add a mock to `adapters/mocks.ts`.
  4. Register it in `container.ts` with a `ContainerOverrides` entry.
  5. In the service, call `this.container.payments.createInvoice(...)` and delete `lib/payments.ts`.

### 2. `server/src/modules/billing/helpers.ts` - helpers runs a DB query through the global db client
- **Why:** `helpers.ts` is meant for pure transforms, but it imports `drizzle-orm`, `db/client.js` and `db/schema/billing.js`. `nextInvoiceNumber()` runs a query against a global `db` singleton. That bypasses `repository.ts` and the container's `db`, so it cannot be swapped in tests or run inside a transaction. The service therefore touches persistence through a back door, and the "no other file imports drizzle" rule is broken. A `count()+1` invoice number is also race-prone under concurrent creates.
- **Fix:** keep only the pure `formatAmount` in `helpers.ts`. Move number generation into `InvoiceRepository` (for example `nextNumber()`), using its injected `this.db`. Prefer a DB sequence or a unique constraint plus retry.

### 3. `server/src/modules/billing/types.ts` and `service.ts` `getRow()` - Drizzle `$inferSelect` leaks through the service
- **Why:** `types.ts` imports `db/schema/billing.js` and defines `InvoiceRow = typeof t.invoices.$inferSelect`. `BillingService.getRow(id): Promise<InvoiceRow | null>` puts that type in a public service signature (the service imports it from `types.ts`). A raw Drizzle row escapes past the repository/service seam. The repo's own pattern maps to the shared domain type (`Invoice`) before the service returns.
- **Fix:** make `InvoiceRow` private to `repository.ts` (non-exported) and delete the `types.ts` re-export. Remove `getRow` from `BillingService`, or have it return `Invoice`. Drop the public `getRow` on the repository if nothing needs the raw row. Keep `InvoiceStatus` in `@devdigest/shared` contracts rather than the module.

### 4. `server/src/modules/customers/routes.ts` - route reaches past the service into another module's repository
- **Why:** `customerRoutes` imports `InvoiceRepository` from `../billing/repository.js` and calls `invoices.listForCustomer()` directly. The route skips both `CustomerService` and `BillingService`. The transport layer now depends on another module's infrastructure and constructs a repository with the raw `app.container.db`.
- **Fix:** add `BillingService.listForCustomer(customerId)`. Have the route call exactly one service method that performs the customer check and fetches the invoices (move the `service.get` plus listing orchestration into a service method). Remove the `InvoiceRepository` import. Better still, serve this endpoint from `billing/routes.ts`.

## Important

### 5. `server/src/modules/billing/service.ts` (line 25) - uses `CustomerRepository` from another module
- **Why:** `new CustomerRepository(this.container.db).get(customerId)` reaches into the customers module's infrastructure layer. Cross-module calls should go through the other module's service (`new CustomerService(this.container)`), not its repository. This bypasses any customer business rule and couples billing to customers' persistence.
- **Fix:** `const customer = await new CustomerService(this.container).get(customerId);` (it already throws `NotFoundError`, so the manual null check goes away).

### 6. `billing/service.ts` <-> `customers/service.ts` - circular module dependency
- **Why:** `BillingService` imports `CustomerService`, and `CustomerService` imports `BillingService`. The call chain is `billing.totalOutstanding -> customers.assertActive`, and `customers.canBeDeactivated -> billing.totalOutstanding`. The static import cycle is unsafe at module-evaluation time, and the two modules cannot be understood or tested in isolation.
- **Fix:** pick one direction, with billing depending on customers (billing is the higher-level module). Move `canBeDeactivated` into `BillingService`, or into a small orchestrating service that depends on both. Remove the `BillingService` import from `customers/service.ts`. Add a dependency-cruiser circular-dependency rule.

### 7. `server/src/modules/billing/repository.ts` - exposes a raw row and has no abstraction
- **Why:** `getRow()` returns `InvoiceRow` (the Drizzle `$inferSelect` type) from a public method, against "return shared/domain types". For a new module with non-trivial persistence (numbering, listing, insert), the skill says to consider an interface so the service can be tested against a mock. The service also hard-codes `new InvoiceRepository(container.db)`.
- **Fix:** delete or make private `getRow`. Consider an `InvoiceStore` interface that the repository implements.

## Minor

### 8. `server/src/modules/billing/routes.ts` - request schema and URL ownership
- **Why:** `CreateInvoiceBody` is defined locally rather than as a shared contract (`@devdigest/shared/contracts`). Business bounds (`lineItemCount` 1..100) are enforced in the service, which is fine, but the schema is not shared with the client. The route `GET /customers/:customerId/outstanding` sits in billing but uses the customers URL namespace, which overlaps with `customers/routes.ts`. Routes otherwise follow parse -> one service call -> map, which is good.
- **Fix:** move the body schema to `@devdigest/shared/contracts/billing.ts` (and copy it to `client/src/vendor/shared`). Pick one module to own each URL namespace.

## Also noted (not layering)
- `BillingService.create` writes the invoice to the DB, then calls Stripe, then records the notification. A Stripe failure leaves an invoice stored locally with no external counterpart. Consider ordering or compensation once the payment port exists.

## Checks that passed
- `NotificationService` created via `new NotificationService(this.container)` at the call site matches the repo convention.
- `CustomerRepository` and `NotificationRepository` return shared types or void, and `billing/routes.ts` imports only its service and zod.
- Module files are role-named; `constants.ts` is clean.
