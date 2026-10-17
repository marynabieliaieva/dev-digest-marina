# Architecture review: billing PR (onion-architecture)

Scope: the 9 files in CHANGED.txt, plus `platform/container.ts` and the `notifications` module for context. Rules used: dependency direction, layer placement, port + container wiring, cross-module calls.

## Verdict: do not open yet. 6 violations (4 blocking), 3 follow-ups.

## Blocking

### 1. `server/src/modules/billing/service.ts` (+ `server/src/lib/payments.ts`): Stripe SDK used directly, no port
- `service.ts` imports `stripe` from `../../lib/payments.js` and calls `stripe.invoices.create(...)`. `lib/payments.ts` does `new Stripe(process.env.STRIPE_KEY ...)` at import time. This is a local wrapper that re-exports a forbidden SDK, so a grep for `stripe` in the service would only show the wrapper.
- Why it matters: the application layer depends on an outer-layer SDK. It cannot be swapped for a mock via `ContainerOverrides`, so unit tests hit Stripe or must module-mock it. The key is read from `process.env` instead of `container.secrets`, and the client is built as an import-time singleton.
- Fix, all four parts:
  1. Add a `PaymentProvider` port (e.g. `createInvoice(customerExternalId, description): Promise<void>`) in `server/src/vendor/shared/adapters.ts`.
  2. Move the Stripe code to `server/src/adapters/payments/stripe.ts`, which takes the key from `secrets`. Delete `lib/payments.ts`.
  3. Add `MockPaymentProvider` in `server/src/adapters/mocks.ts`.
  4. Add an async `payments()` getter, with an override, in `platform/container.ts`. The service then does `const payments = await this.container.payments()`.

### 2. `server/src/modules/billing/helpers.ts`: Drizzle, `db/client` and `db/schema` imported in a helper, with a global db
- Imports `drizzle-orm`, `{ db } from '../../db/client.js'` and `db/schema/billing.js`, and runs a query in `nextInvoiceNumber()`.
- Why it matters: `helpers.ts` is meant for pure transforms. Persistence belongs in `repository.ts` only. It also bypasses the container's db by importing the global `db`, so the code is untestable with injected deps and can run on a different connection or transaction than the repository. `count + 1` is also a race: two concurrent creates get the same invoice number.
- Fix: keep only pure functions in `helpers.ts` (`formatAmount`, and a pure `formatInvoiceNumber(n)`). Add `InvoiceRepository.nextNumber()` using `this.db`. Ideally allocate the number from a DB sequence or a unique constraint with retry, in the same transaction as the insert.

### 3. `server/src/modules/billing/types.ts`, `repository.ts`, `service.ts`: Drizzle row type leaks through the service
- `types.ts` exports `InvoiceRow = typeof t.invoices.$inferSelect` and imports `db/schema/billing.js` (outside `repository.ts`). `InvoiceRepository.getRow()` returns it, and the public `BillingService.getRow(): Promise<InvoiceRow | null>` hands it to every caller.
- Why it matters: callers now depend on the table shape, which is a layering violation. `repository.ts` already has the correct `toInvoice` mapper and `get()`, so `getRow` is redundant.
- Fix: delete `getRow` from the repository and service (use `get()` returning the shared `Invoice`). Remove `InvoiceRow` from `types.ts`, or define it locally inside `repository.ts` unexported. Keep only `InvoiceStatus` in `types.ts` (better: take it from `@devdigest/shared`).

### 4. `server/src/modules/customers/routes.ts`: route reaches past the service into another module's repository
- Imports `InvoiceRepository` from `../billing/repository.js`, builds it from `app.container.db`, and calls `invoices.listForCustomer(...)` in the handler.
- Why it matters: the route skips the service layer and touches another module's persistence. The handler does two things (service call, then repo call) instead of exactly one service call, and any rules billing adds later are bypassed.
- Fix: add `BillingService.listForCustomer(customerId)` (or a `CustomersService` method that delegates to it) and have the route call one service method. Remove the `InvoiceRepository` import.

## Important

### 5. `customers/service.ts` <-> `billing/service.ts`: circular module dependency
- `BillingService.totalOutstanding` constructs `CustomerService` (`assertActive`), and `CustomerService.canBeDeactivated` constructs `BillingService` (`totalOutstanding`). The import cycle exists at module level (`billing/service.ts` imports `customers/service.ts`, which imports `billing/service.ts`), and also at runtime: `totalOutstanding` -> `assertActive` is fine today, but any future `canBeDeactivated` call from billing recurses.
- Why it matters: two modules that cannot be reasoned about, loaded, or tested independently; ESM cycles can produce undefined-at-import bugs.
- Fix: make the dependency one-way. Billing depends on customers (it needs customer validation). Move the "can this customer be deactivated" decision to the caller that orchestrates (e.g. a customers use case that asks `BillingService.totalOutstanding`), or move that orchestration into billing. Do not have both services construct each other. If both truly need each other, extract the shared piece (outstanding balance query) into a small third unit both can use.

### 6. `server/src/modules/billing/service.ts`: uses `CustomerRepository` from another module
- `new CustomerRepository(this.container.db).get(customerId)` bypasses the customers service.
- Why it matters: cross-module calls should go service-to-service (`new OtherService(this.container)`), not into another module's repository. This duplicates the not-found rule that `CustomerService.get` already owns and couples billing to customers' persistence.
- Fix: replace with `await new CustomerService(this.container).get(customerId)` (it already throws `NotFoundError`, so the manual check goes away). Note this makes the cycle in item 5 more visible, so resolve both together.

## Follow-ups (non-blocking, but flag)

- **Order of side effects in `BillingService.create`:** the invoice row is inserted, then Stripe is called, then the notification is recorded, with no transaction or compensation. If Stripe fails, a local `open` invoice exists with no external counterpart. Decide on an ordering/compensation strategy; make the notification best-effort so it cannot fail invoice creation.
- **Repository has no interface:** `InvoiceRepository` is instantiated directly (`new InvoiceRepository(container.db)`). This matches existing modules and is an accepted gap, but for a new module with this much logic consider an `IInvoiceRepository` so `BillingService` can be tested with a mock.
- **Stripe field naming leaking into the domain:** `customer.stripeId` is used in the service. When the `PaymentProvider` port is added, rename to a provider-neutral `externalPaymentId` on the shared contract, so the domain does not name a vendor.

## What is fine
- `billing/routes.ts` is transport-only: parses with Zod, calls one service method per handler, maps status. Its imports are correct.
- `billing/repository.ts` maps rows to the shared `Invoice` type in `toInvoice` (apart from the `getRow` leak above).
- `constants.ts` holds literals only; `notifications` module is correctly layered and the cross-module `new NotificationService(this.container)` call follows the convention.
