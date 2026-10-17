# Architecture review: billing PR

Scope: the 9 files in CHANGED.txt, plus the files they import (customers/repository.ts, notifications/*, platform/*, db/*) followed one hop, per the onion-architecture skill.

Verdict: **do not open yet.** 7 problems, 4 of them blocking. Most are indirect: a plain grep of `service.ts` for `drizzle-orm` or `stripe` finds only one of them.

## Blocking

### 1. `billing/service.ts` imports a Stripe wrapper directly (SDK without a port)
- Files: `server/src/lib/payments.ts` (`export const stripe = new Stripe(...)`), used at `server/src/modules/billing/service.ts:4` and `:31`.
- Why: `lib/payments.ts` is the vendor SDK under a local name. The service (application layer) depends on a concrete SDK, so it cannot be swapped through `ContainerOverrides` or mocked in unit tests. It also reads `process.env.STRIPE_KEY` at import time, bypassing the container and secrets provider. No `PaymentProvider` port, adapter, mock or container registration exists (all four are required for a new integration). A Stripe failure also escapes as a raw vendor exception instead of `ExternalServiceError` (not defined in the `platform/errors.ts` snapshot, so add it).
- Fix: add a `PaymentProvider` port (`createInvoice(customerStripeId, description)`) to `@devdigest/shared/adapters.ts`; implement it in `server/src/adapters/payments/stripe.ts` (the only file importing `stripe`, wrapping failures in `ExternalServiceError`); add a mock to `adapters/mocks.ts`; register it in `platform/container.ts` (with an override). The service then calls `this.container.payments.createInvoice(...)`. Delete `lib/payments.ts`.

### 2. `billing/service.ts` reaches Drizzle and the db client through `helpers.ts`
- Chain: `service.ts:9` -> `helpers.ts:1-3` -> `drizzle-orm`, `db/client.js` (global `db`), `db/schema/billing.js`.
- Why: `nextInvoiceNumber()` runs a query in `helpers.ts`, which must be pure. The service therefore reaches persistence outside `repository.ts`, using a module-level `db` singleton instead of `container.db` (breaks test containers and transactions). It is also race-prone: count+1 gives duplicate invoice numbers under concurrent requests.
- Fix: keep only `formatAmount` in `helpers.ts`. Move number generation into `InvoiceRepository` (e.g. `insertWithNextNumber`, using a DB sequence or a unique constraint with retry, in one transaction), so `helpers.ts` imports only `constants.ts`.

### 3. Drizzle row type leaks through `types.ts` into the service's public API
- Files: `billing/types.ts:3` (`InvoiceRow = typeof t.invoices.$inferSelect`), `billing/service.ts:11,39-41` (`getRow(): Promise<InvoiceRow | null>`), `billing/repository.ts:25` (`getRow`).
- Why: a `$inferSelect` alias is still a Drizzle type; a public service method must return shared/domain types. The row type is allowed only at the repository/service seam. `repository.ts` also exposes `getRow` publicly, and the service re-exports the raw row to any caller.
- Fix: delete `service.getRow` and `repository.getRow` if unused, or return the shared `Invoice`. Keep `InvoiceRow` private to `repository.ts` (move it there) so `types.ts` keeps only `InvoiceStatus`. Better, derive `InvoiceStatus` from the shared contract.

### 4. Import cycle: `billing/service.ts` <-> `customers/service.ts`
- Files: `billing/service.ts:6,44` (`new CustomerService(...).assertActive`) and `customers/service.ts:4,26` (`new BillingService(...).totalOutstanding`).
- Why: each service constructs the other; a module cycle makes the two modules impossible to reason about, test or load independently (ESM initialization-order risk).
- Fix: make the dependency one-way. Billing is the higher-level module and may call `CustomerService`. For `canBeDeactivated`, move the "outstanding invoices" check out of `customers/service.ts` into billing (e.g. `BillingService.canDeactivateCustomer`) or have the caller (a route or deactivation use case) combine the two. Customers should not know about billing.

## Should fix

### 5. `billing/service.ts` bypasses the customers module's rules (cross-module repository access)
- File: `billing/service.ts:5,25` (`new CustomerRepository(this.container.db).get(customerId)`).
- Why: skips `CustomerService` (not-found handling, active check). Notably `create` never checks the customer is active, while `totalOutstanding` does, so the two paths enforce different rules.
- Fix: use `new CustomerService(this.container).assertActive(customerId)` (which also returns not-found) and fetch the customer via `CustomerService.get`. Remove the `CustomerRepository` import.

### 6. `customers/routes.ts` reaches into another module's repository
- File: `customers/routes.ts:3,7,14` (`InvoiceRepository` instantiated in the route, `invoices.listForCustomer`).
- Why: transport layer skipping the service layer, and into another module's persistence. The `/customers/:id/invoices` endpoint also orchestrates two calls (existence check, then query) inside the handler, which is business logic in `routes.ts`.
- Fix: add `BillingService.listForCustomer(customerId)` (calling `CustomerService.get` first) and have the route call that single service method. Better, move the endpoint into `billing/routes.ts`, where `/customers/:customerId/outstanding` already lives.

## Minor

### 7. Persistence not behind a port, and DB write plus external call not coordinated
- File: `billing/service.ts:29-31`.
- Why: the invoice is inserted, then Stripe is called with no transaction or compensation. If Stripe fails, a local `open` invoice exists with no remote counterpart. Repositories are also un-inverted (acceptable for existing modules, but the skill asks new modules with non-trivial logic to consider an interface).
- Fix: call the payment port first (or wrap both in a unit of work with a compensating status), and consider an `IInvoiceRepository` interface for service tests.

## Checked and fine (not violations)
- Services taking the whole `Container` and building their own `new XRepository(container.db)`.
- `new NotificationService(this.container)` from billing (one-way call; notifications imports nothing from billing).
- `billing/routes.ts`: parses the body and calls one service method per route; no db/SDK imports. The `lineItemCount` range check correctly lives in the service and throws `ValidationError`.
- `drizzle-orm` imports inside the three `repository.ts` files; `billing/repository.ts` maps rows to the shared `Invoice` for its other methods.
- `billing/constants.ts`: literals only.
