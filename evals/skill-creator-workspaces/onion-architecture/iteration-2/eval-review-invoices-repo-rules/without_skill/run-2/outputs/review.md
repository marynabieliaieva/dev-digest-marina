# Architecture review: invoices + email notification PR

## Problems

### 1. Service imports the DB schema and uses Drizzle types
File: `server/src/modules/invoices/service.ts`
Why: `import { invoices } from '../../db/schema/invoices.js'` and `typeof invoices.$inferInsert` as the `create()` parameter type. The application layer is coupled to the persistence schema (infrastructure). A column rename or ORM swap changes the service's signature.
Fix: Define a domain/contract input type (e.g. `CreateInvoiceInput` from `@devdigest/shared`) and use it in `service.create`. Keep Drizzle types inside `repository.ts`, which maps input to `InvoiceInsert`.

### 2. Service depends on the whole Container (service locator) and builds its own repository
File: `server/src/modules/invoices/service.ts`
Why: `InvoiceService` takes `Container`, reaches into `container.db` and `container.email`, and does `new InvoiceRepository(container.db)`. Dependencies are hidden, the service is hard to unit test without a full container, and it knows about the DB handle directly.
Fix: Inject narrow dependencies via the constructor: `constructor(repo: InvoiceRepository (or a port interface), email: EmailSender)`. Compose them in the route or plugin wiring.

### 3. Routes instantiate the service and reach into `app.container`
File: `server/src/modules/invoices/routes.ts`
Why: `new InvoiceService(app.container)` in the transport layer makes routes the composition root and passes the entire container down.
Fix: Build the service in the composition root/container (or a module factory) and have routes receive a ready `InvoiceService`.

### 4. Route handler builds the domain/DB input and converts types
File: `server/src/modules/invoices/routes.ts`
Why: The route maps body to the insert shape and does `new Date(body.dueDate)`. This is also what forces the service to take a Drizzle insert type (`dueDate: Date`) while the contract says `dueDate: string`. There is no validation that the date is valid (invalid date gives `Invalid Date`, which then throws at `toISOString()` / DB write as a 500). `parse()` throws a raw ZodError with no error mapping.
Fix: Pass the validated DTO to the service and let the service/repository do the conversion. Validate `dueDate` in the contract (`z.string().datetime()` or `z.coerce.date()`). Use `safeParse` or a shared error handler to return 400.

### 5. Email send is coupled to invoice creation, in the same call path, with no failure isolation
File: `server/src/modules/invoices/service.ts`
Why: After the DB insert, `await this.container.email.send(...)` runs inline. If SendGrid fails, `create` throws after the invoice has already been persisted, so the client gets a 500 and retries, creating a duplicate invoice. Latency of a third party is also added to the request. Message composition (subject/body) is business/presentation logic hard-coded in the service, and `amountCents / 100` formatting is wrong for non-2-decimal currencies.
Fix: Treat notification as a side effect: catch and log failures (or enqueue via an outbox/event handler), do not fail the create. Move message building into a small notifier/template helper that formats money correctly (e.g. `Intl.NumberFormat`).

### 6. Container directly imports a concrete vendor adapter and reads env inside a getter
File: `server/src/platform/container.ts`
Why: The email adapter is constructed lazily in a getter with `process.env.SENDGRID_API_KEY ?? ''` and a hard-coded sender `'billing@example.com'`. This is inconsistent with `secrets`, which is built in the constructor and overridable. There is no `email` entry in `ContainerOverrides`, so tests cannot inject a fake (and a `MockEmailSender` was not added to `adapters/mocks.ts`). With an empty key fallback, misconfiguration fails silently at send time instead of at startup. The key bypasses the `SecretsProvider` abstraction already present.
Fix: Add `email?: EmailSender` to `ContainerOverrides`, build it in the constructor, read the API key through `this.secrets.get(...)` and the sender address from config, and fail fast if missing. Add `MockEmailSender` to `server/src/adapters/mocks.ts`.

### 7. Adapter does global SDK configuration in the constructor
File: `server/src/adapters/email/sendgrid.ts`
Why: `sgMail.setApiKey` mutates a module-level singleton, so multiple instances share/override state and construction has side effects. It also sends only plain `text`, with no error translation (vendor errors leak up to the application layer).
Fix: Use a client instance owned by the adapter (or isolate the singleton setup in one place) and wrap errors in a domain-level error (e.g. `EmailDeliveryError`) so callers do not depend on SendGrid's error shapes.

### 8. Port declared in `adapters.ts` in the shared package
File: `server/src/vendor/shared/adapters.ts`
Why: This is lower severity, but the `EmailSender` port is placed in the vendor/shared package that is consumed by client, server and others, although it is server-only. This widens the cross-package surface.
Fix: If `shared` is meant to contain only cross-package contracts, keep server-only ports in the server's domain/ports location (acceptable if the repo's convention already puts ports here, as with `SecretsProvider`; confirm the convention).

### 9. Contract mismatch: client copy of invoice contract is out of sync with the server
File: `client/src/vendor/shared/contracts/invoice.ts` (and `server/src/vendor/shared/contracts/invoice.ts`)
Why: The server contract adds `dueDate` to `Invoice` and `CreateInvoiceBody`; the client copy does not. The client will fail to send required `dueDate` and will strip/ignore it in responses. This file is also not listed in `CHANGED.txt`, so the PR updates one side only. Duplicated contracts invite this drift.
Fix: Update the client copy (or sync from the single source of truth) in the same PR, and add a check that the two copies are identical.

### 10. Repository returns the contract type and takes raw insert type
File: `server/src/modules/invoices/repository.ts`
Why: `insert(values: InvoiceInsert)` exposes the Drizzle insert shape in the repository's public API (which is what lets the service import the schema). `markPaid` is not idempotent: re-marking overwrites `paidAt`. Mapping rows directly to the transport DTO (`Invoice` from the zod contract) couples persistence to the wire format (e.g. dates as ISO strings).
Fix: Accept a domain input type in `insert`; have the repository return a domain entity and map to the wire shape at the edge. Make `markPaid` conditional on `paidAt IS NULL`.

## Missing from the PR
- No `server/src/db/schema/invoices.ts` or migration appears in `CHANGED.txt`, yet the repository/service import it (migrations must be generated, not hand-written).
- `invoiceRoutes` registration and any tests are not in the changed list.
- No `MockEmailSender` for tests.

## Summary
Top priorities: remove the Drizzle schema import from the service (1), inject narrow dependencies instead of the Container (2, 3), make email non-fatal to creation (5), make the email adapter overridable and configured via secrets (6), and sync the client contract (9).
