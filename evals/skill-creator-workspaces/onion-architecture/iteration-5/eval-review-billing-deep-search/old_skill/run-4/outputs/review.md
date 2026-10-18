# Architecture review: billing PR (onion-architecture)

Scope: the 9 files in CHANGED.txt, plus the files they import (`container.ts`, `notifications/*`, `customers/repository.ts`) for context.
Rule applied: imports may only point inward. `routes.ts` -> `service.ts` -> (ports, own `repository.ts`, other modules' *services*). Only `repository.ts` and adapters may touch Drizzle or SDKs.

Verdict: do not open the PR yet. 7 problems (4 high, 3 medium) and 2 minor notes.

## High

### 1. `billing/service.ts` (and `lib/payments.ts`): Stripe SDK used directly, no port
- Why: `service.ts` imports `stripe` from `../../lib/payments.js`, a wrapper that does `new Stripe(process.env.STRIPE_KEY)`. A wrapper module that re-exports an SDK is the same violation as importing `stripe` in the service. It is a module-level singleton that reads `process.env` itself. It bypasses `container.ts`, so tests cannot swap it for a mock via `ContainerOverrides`. The service now depends on a concrete outer-layer SDK.
- Fix: new external integration, so follow the 4-step recipe.
  1. Add a `PaymentGateway` port (e.g. `createInvoice({ customerExternalId, description })`) to `@devdigest/shared/adapters.ts`.
  2. Move the Stripe code to `server/src/adapters/payments/` (the only file importing `stripe`, key from config/SecretsProvider). Delete `lib/payments.ts`.
  3. Add a mock in `server/src/adapters/mocks.ts`.
  4. Register it in `platform/container.ts` (+ `ContainerOverrides`). The service calls `this.container.payments.createInvoice(...)`.

### 2. `billing/helpers.ts`: direct `db` client and schema import, I/O in helpers
- Why: it imports `db` from `db/client.js` and `* as t from db/schema/billing.js` and runs a query in `nextInvoiceNumber()`. `helpers.ts` is for pure transforms, and persistence belongs only in `repository.ts`. It also uses the global `db` instead of the injected `container.db`, so it is not testable and ignores any transaction. The count-based numbering (`count()+1`) is also racy: two concurrent requests get the same number.
- Fix: move numbering into `InvoiceRepository` (e.g. `nextNumber()`, ideally a DB sequence or an insert-time generated number in the same transaction). Keep only pure `formatAmount` in `helpers.ts`.

### 3. `billing/service.ts` <-> `customers/service.ts`: circular dependency between modules
- Why: `BillingService` constructs `CustomerService` (`totalOutstanding`), and `CustomerService` constructs `BillingService` (`canBeDeactivated`). Two services in an import cycle means the modules cannot be reasoned about, loaded, or tested independently and risks init-order bugs. Dependencies between application services must be one-directional.
- Fix: pick a direction. Billing depends on customers (already needed for `assertActive`). Remove the `BillingService` import from `CustomerService`: either move `canBeDeactivated` into billing (e.g. `BillingService.canCustomerBeDeactivated`), or have the caller/orchestrating route compose the two, or expose the data needed via a small inward-pointing function/port passed in.

### 4. `customers/routes.ts`: route reaches past the service into another module's repository
- Why: it imports `InvoiceRepository` from `../billing/repository.js` and builds it from `app.container.db`, then calls `invoices.listForCustomer` directly. Routes may only call their own `service.ts`; this skips the application layer and couples customers' transport layer to billing's persistence. It also does orchestration (`service.get` then repository call) in the handler, which is business logic in the wrong layer.
- Fix: add `BillingService.listForCustomer(customerId)` (or put the orchestration in `CustomerService`, calling `new BillingService(this.container)` — mind issue 3) and have the route call one service method. Better: serve it from billing routes (`/customers/:id/invoices` in the billing module).

## Medium

### 5. `billing/service.ts`: imports and instantiates another module's repository
- Why: `new CustomerRepository(this.container.db).get(...)` reaches into the customers module's persistence, bypassing `CustomerService` (which already has `get()` with the not-found check). Cross-module calls must go service-to-service via `new CustomerService(this.container)`. This duplicates the not-found rule and couples billing to the customers' storage.
- Fix: `const customer = await new CustomerService(this.container).get(customerId);` and drop the manual `NotFoundError` check and the repository import.

### 6. `billing/types.ts`, `billing/repository.ts`, `billing/service.ts`: Drizzle `$inferSelect` type leaks through the service API
- Why: `types.ts` imports `db/schema/billing.js` and exports `InvoiceRow = typeof t.invoices.$inferSelect`. `BillingService.getRow()` has `InvoiceRow` in its public return type, and `InvoiceRepository.getRow` returns it. A raw Drizzle row type escaping past the service is a layering violation (the repo-to-service seam must map to a shared/domain type). `getRow` also just proxies the repository with no logic.
- Fix: drop `getRow` from the service (and repository) if unused, or return the `Invoice` domain type via `toInvoice`. Keep any `InvoiceRow` type private to `repository.ts` and do not export it from `types.ts`. Move `InvoiceStatus` into the shared contract (Zod enum) since `Invoice.status` is a shared type.

### 7. `billing/service.ts` `create()`: side effects outside any transaction/ordering protection
- Why: invoice is inserted, then Stripe is called, then a notification is recorded. If Stripe fails, a local `open` invoice exists with no remote counterpart and the number is consumed; if the notification fails the request errors after money-affecting work. This orchestration belongs in the application layer but is not safe as written. (Design concern, not an import violation.)
- Fix: create the remote invoice first (or insert as `draft`, call the gateway, then mark `open`), wrap persistence in a transaction, and make notification best-effort (non-blocking / caught).

## Minor notes
- `billing/repository.ts` has no interface; acceptable for existing patterns, but this repository now carries numbering/list logic, so consider an `IInvoiceRepository` for service tests.
- `billing/routes.ts` is otherwise correct (parse, one service call, status mapping). Input validation of `lineItemCount` range lives in the service, which is fine; consider also bounding it in the Zod schema.

## Checklist summary
| Check | Result |
|---|---|
| service imports concrete SDK / db | FAIL (stripe via lib wrapper) |
| helpers/other non-repository files import db client/schema | FAIL (`helpers.ts`, `types.ts`) |
| routes reach past service | FAIL (`customers/routes.ts`) |
| `$inferSelect` in service signature | FAIL (`getRow`) |
| cross-module via service only | FAIL (`CustomerRepository` in billing) |
| no circular module deps | FAIL (billing <-> customers) |
| new integration has port + adapter + mock + container | FAIL (none) |
| billing `routes.ts` transport-only | PASS |
