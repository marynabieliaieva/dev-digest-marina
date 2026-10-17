# Architecture review: billing PR (onion-architecture skill)

Scope: files in `fixtures/billing-pr/CHANGED.txt` (server only). Dependency rule: imports may only point inward; SDKs, `drizzle-orm`, and `db/*` belong only in adapters and `repository.ts`.

## Blocking problems

### 1. `billing/service.ts` uses Stripe directly through a local wrapper (`lib/payments.ts`)
- Files: `server/src/modules/billing/service.ts` (line 4 import, line 31 call), `server/src/lib/payments.ts`.
- Why: `payments.ts` re-exports a ready-made `new Stripe(process.env.STRIPE_KEY)` singleton. A grep for `stripe` in the service would still find it. This is the skill's main violation: a service depending on a concrete SDK, hidden behind a wrapper. There is no port in `shared/adapters.ts`, no adapter under `server/src/adapters/`, no mock in `adapters/mocks.ts`, and no `container.ts` getter or `ContainerOverrides` entry. `BillingService.create` cannot be unit-tested without hitting Stripe. The key is read from `process.env` at import time instead of through the secrets provider, and it defaults to an empty string.
- Fix: add a `PaymentsClient` port (for example `createInvoice({ customerStripeId, description })`) to `@devdigest/shared/adapters.ts`. Move the Stripe code to `server/src/adapters/payments/stripe.ts`, the only file allowed to import `stripe`. Add `MockPaymentsClient` to `adapters/mocks.ts`. Add `async payments()` to `Container` with an override, taking the key from `secrets.get(...)`. In the service use `(await this.container.payments()).createInvoice(...)`. Delete `lib/payments.ts`.

### 2. `billing/helpers.ts` queries the database
- File: `server/src/modules/billing/helpers.ts` (imports `drizzle-orm`, `db/client.js`, `db/schema/billing.js`; `nextInvoiceNumber`).
- Why: `helpers.ts` should hold pure transforms. This one imports the global `db` singleton and runs a query, so it bypasses `repository.ts` and the container (it ignores `container.db`, so tests cannot inject a db). `service.ts` imports it, so the service reaches the DB through a local wrapper, which is the same violation as importing `drizzle-orm`. The count-plus-one numbering is also racy: two concurrent requests can get the same number.
- Fix: keep only `formatAmount` (pure) in `helpers.ts`. Move number generation into `InvoiceRepository` (for example `insertWithNextNumber`, using a DB sequence or a transaction/unique constraint). The service calls the repository method.

### 3. Circular dependency between `billing` and `customers` services
- Files: `server/src/modules/billing/service.ts` (imports `CustomerService`, uses `assertActive`), `server/src/modules/customers/service.ts` (imports `BillingService`, uses `totalOutstanding`).
- Why: `billing/service -> customers/service -> billing/service` is an import cycle. At runtime it can leave one class undefined during module init. It also makes the two modules inseparable and gives them circular business rules: `totalOutstanding` calls `assertActive`, and `canBeDeactivated` calls `totalOutstanding`.
- Fix: make the dependency one-way. Billing may depend on customers (`CustomerService.assertActive`). Customers should not call billing. Move `canBeDeactivated` into `BillingService`, or into a higher-level orchestrator or route that composes both. Alternatively, have the caller pass the outstanding amount in.

### 4. `billing/service.ts` imports another module's repository
- File: `server/src/modules/billing/service.ts` (line 5, line 25: `new CustomerRepository(this.container.db)`).
- Why: it skips the customers module's service layer and its rules. The repository is the other module's infrastructure detail, so the two modules are coupled at the persistence level. `CustomerService.get` already throws `NotFoundError`, so the service duplicates that logic.
- Fix: call `new CustomerService(this.container).get(customerId)`, which also gives you `stripeId`. Remove the `CustomerRepository` import.

### 5. `customers/routes.ts` reaches into billing's repository
- File: `server/src/modules/customers/routes.ts` (imports `InvoiceRepository`, calls `invoices.listForCustomer`).
- Why: a route handler must call exactly one service method. Here it queries a repository from another module directly, skipping the service layer. It also puts orchestration (check the customer exists, then list) in the transport layer.
- Fix: add `BillingService.listForCustomer(customerId)` (it can call `CustomerService.get` first). The route calls only that service method. If customers must not depend on billing (see #3), move the `/customers/:id/invoices` route into `billing/routes.ts`.

### 6. Drizzle row type leaks through the service's public API
- Files: `server/src/modules/billing/service.ts` (`getRow(): Promise<InvoiceRow | null>`), `server/src/modules/billing/repository.ts` (`getRow`), `server/src/modules/billing/types.ts`.
- Why: `InvoiceRow` is `typeof t.invoices.$inferSelect`. Exposing it in a service method signature leaks the table shape to every caller, including other modules. `types.ts` imports `db/schema/billing.js` from outside `repository.ts`, which is the wrapper-import pattern the skill flags. The repository already has a mapped `get()` returning the shared `Invoice`, so `getRow` is redundant.
- Fix: delete `getRow` from the service and repository. Return the shared `Invoice` type everywhere. If the raw row type is needed, keep it private inside `repository.ts`. Remove the `db/schema` import from `types.ts`. Move `InvoiceStatus` to `@devdigest/shared` contracts or derive it from the Zod schema.

## Non-blocking / worth fixing

### 7. Side effects after the DB insert with no failure handling
- File: `server/src/modules/billing/service.ts` (`create`).
- Why: the invoice is inserted, then the Stripe call and the notification run. If Stripe fails, a local `open` invoice exists without a matching remote invoice. If the notification fails, `create` throws even though the invoice was created and sent to Stripe. The notification is a best-effort side effect.
- Fix: make the order and compensation explicit (create the remote invoice first, or mark a failure status). Make the notification best-effort with a logged catch.

### 8. Repository constructed from raw `container.db` with no interface
- Files: `billing/service.ts`, `customers/service.ts`.
- Why: this matches the existing convention, so it is not a violation. The skill's guidance is that a new module with non-trivial logic should consider an `IInvoiceRepository` interface so the service can be tested against a mock.
- Fix: optional. Consider a repository interface for billing, especially once the numbering logic moves into the repository (#2).

### 9. Route ownership
- File: `server/src/modules/billing/routes.ts`.
- Why: `GET /customers/:customerId/outstanding` is a customer-scoped route served by the billing module. The `lineItemCount` range rule lives only in the service, which is the right layer.
- Fix: no layering change needed. Consider the route-ownership question together with #3 and #5.

## Summary
Fix 1 to 6 before opening the PR. The core issues are the unabstracted Stripe SDK (#1), the database access in `helpers.ts` (#2), the billing/customers service cycle (#3), and the cross-module repository access (#4, #5). The parts that follow the repo's patterns are fine: `routes.ts` to `service.ts` to `repository.ts`, mapping rows to shared types in `InvoiceRepository`, and `new NotificationService(this.container)` for the cross-module call.
