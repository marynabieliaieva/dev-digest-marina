# Architecture review: billing PR (onion-architecture)

Scope: the files in CHANGED.txt, read against the fixture's `customers`, `notifications` and `platform` modules. Dependency rule: imports may only point inward; `service.ts` depends on ports through the Container and never on SDKs or the DB; `routes.ts` talks only to its own service; Drizzle stays in `repository.ts`.

Verdict: do not open the PR yet. Findings 1-6 are blocking.

## Blocking

### 1. `server/src/lib/payments.ts` and `server/src/modules/billing/service.ts` (lines 4, 31): Stripe SDK used directly through a `lib/` singleton
`service.ts` imports `stripe` from `lib/payments.ts` and calls `stripe.invoices.create(...)`. The application layer depends on a concrete SDK, so it cannot be swapped for a mock via `ContainerOverrides`, and tests would hit the real SDK.
`lib/payments.ts` is the root problem: it runs `new Stripe(process.env.STRIPE_KEY ...)` at import time. That is an SDK client constructed outside the container, with env access in a non-adapter file, and `lib/` is not a layer here.
Fix: add a `PaymentProvider` port (e.g. `createInvoice({ customerRef, description })`) to `@devdigest/shared/adapters.ts`. Put the Stripe implementation in `server/src/adapters/payments/` (the only file importing `stripe`). Add a mock in `adapters/mocks.ts`. Register it in `platform/container.ts` with an override. `BillingService` then uses `this.container.payments`. Delete `lib/payments.ts`.

### 2. `server/src/modules/billing/helpers.ts` (lines 1-3, 10-13): DB access from helpers via the global `db`
`helpers.ts` imports `drizzle-orm`, `db/client.js` and `db/schema/billing.js`, and `nextInvoiceNumber()` queries the DB through the module-level `db`. `helpers.ts` is for pure transforms; persistence belongs only in `repository.ts`. It also bypasses `container.db`, so tests cannot inject a database. This is a local wrapper that re-exports the forbidden dependency, so a grep for `drizzle-orm` in `service.ts` alone would miss it. The count+1 numbering is also racy under concurrent inserts.
Fix: move number generation into `InvoiceRepository` (e.g. `nextNumber()`, or generate inside `insert` with a DB sequence or one transaction). Keep only `formatAmount` (pure) in `helpers.ts`.

### 3. `server/src/modules/billing/types.ts` and `service.ts` (lines 11, 39-41): Drizzle `$inferSelect` type leaks through the service
`types.ts` defines `InvoiceRow = typeof t.invoices.$inferSelect`, and `BillingService.getRow()` returns `Promise<InvoiceRow | null>`, putting a raw persistence row type in a public service signature. `repository.getRow` exposes it too. The repository already maps rows to the shared `Invoice` via `toInvoice`, so the escape hatch is unnecessary.
Fix: remove `getRow` from the service (and the repository unless needed internally), or return the shared `Invoice` (use `get`). Keep `InvoiceRow` private to `repository.ts`. `InvoiceStatus` belongs in `@devdigest/shared` contracts (Zod enum), not a module-local type.

### 4. `server/src/modules/billing/service.ts` (lines 5, 25): reaches into another module's repository
`new CustomerRepository(this.container.db).get(customerId)` skips the customers `service.ts`, so rules that module applies are bypassed and duplicated here (`NotFoundError` re-implemented). Cross-module calls must go service to service.
Fix: use `new CustomerService(this.container).get(customerId)` (already throws NotFound), drop the `CustomerRepository` import, and consider `assertActive` before billing a customer.

### 5. Circular dependency: `billing/service.ts` <-> `customers/service.ts`
`BillingService` imports and instantiates `CustomerService` (`totalOutstanding`), and `CustomerService.canBeDeactivated` imports and instantiates `BillingService`. The two modules depend on each other; dependencies must form a DAG, and construction could recurse if a constructor ever builds the other service.
Fix: pick one direction. Billing needs customers, so remove `BillingService` from `CustomerService`. Move `canBeDeactivated` into billing (or have the caller orchestrate), or expose the outstanding-balance query through a read-only repository method or small port. Enforce with a dependency-cruiser `no-circular` rule.

### 6. `server/src/modules/customers/routes.ts` (lines 3, 7, 11-14): route bypasses the service, reaches into another module's repository, and orchestrates
The route imports `InvoiceRepository` from `billing`, builds it from `app.container.db`, and calls it after a separate `service.get()`. That is a route skipping `service.ts`, depending on another module's infrastructure, with orchestration (existence check then fetch) that belongs in a service. It adds a second customers-to-billing edge.
Fix: add `BillingService.listForCustomer(customerId)` and have the route call exactly one service method, or move `GET /customers/:id/invoices` into `billing/routes.ts`. Keep the direction consistent with the fix for #5.

## Should fix

### 7. `server/src/modules/billing/service.ts` (lines 29-36): two external effects with no failure policy
The invoice is inserted, then Stripe is called, then a notification recorded. If Stripe fails, the local row stays `open` with no remote counterpart; if the notification fails after Stripe succeeded, the request errors although the invoice exists. Define the policy in the service (transaction/outbox, call Stripe first, or compensate) once the `PaymentProvider` port exists (#1).

### 8. `server/src/modules/billing/service.ts` (line 31) and the Customer contract: vendor field in the domain type
`customer.stripeId` sits on the shared `Customer` type, leaking a vendor name into the domain layer. Rename to a provider-neutral `paymentRef`/`externalId` when introducing the port.

### 9. `server/src/modules/billing/routes.ts` (lines 5-9, 20): request schema local to the route; ambiguous route ownership
`CreateInvoiceBody` is a local Zod schema while `Invoice` is a shared contract. Shapes the client also needs belong in `@devdigest/shared/contracts/*` (plus the manual copy to `client/src/vendor/shared`). Also `GET /customers/:customerId/outstanding` is a customer-scoped URL living in billing, overlapping the customers namespace; make ownership explicit.

### 10. `server/src/modules/billing/service.ts` (line 17): persistence not behind an interface
`BillingService` instantiates `InvoiceRepository` directly. This is the repo's known gap and acceptable for existing modules, but billing's repository now has non-trivial logic, so consider an `IInvoiceRepository` interface so the service can be tested with a mock, as GitHub/LLM already are.

## Checklist result
1. Service imports concrete SDK: FAIL (stripe via `lib/payments.ts`; drizzle via `helpers.ts`)
2. Routes reach past service: FAIL (`customers/routes.ts`)
3. `$inferSelect` in service signature: FAIL (`getRow`)
4. Business logic in routes: customers route orchestrates (partial)
5. New integration has port, adapter, mock, container registration: FAIL (none of the four)
6. Domain imports outward: pass
7. Repository interface considered: not done

Not a problem: `NotificationService` use from billing (service to service via `new X(this.container)`), `constants.ts`, and `InvoiceRepository` mapping rows with `toInvoice`.
