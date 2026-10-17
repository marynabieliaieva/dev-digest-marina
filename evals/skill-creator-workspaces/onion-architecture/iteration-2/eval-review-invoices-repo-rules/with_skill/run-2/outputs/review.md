# Architecture review: invoices + email notification PR

Reviewed against the onion-architecture rules (dependency direction, ports/adapters/mocks/container, service/route/repository roles). Summary: the port (`EmailSender`), the adapter and the repository mapping are done well; there are 2 blocking problems, 3 should-fix problems, and 1 minor note.

## Blocking

### 1. `server/src/modules/invoices/service.ts` - service imports the DB schema and exposes a Drizzle type
- Problem: `import { invoices } from '../../db/schema/invoices.js'` plus `create(values: typeof invoices.$inferInsert)`. The application layer must not import `db/schema/*` (same violation as importing `drizzle-orm`; persistence belongs to `repository.ts`), and a `$inferInsert` type in a service method signature leaks the persistence shape inward/upward to callers (`routes.ts` has to build a DB row).
- Fix: remove the schema import. Take a shared type: `create(input: CreateInvoiceBody): Promise<Invoice>`. Do the mapping to the insert shape (`dueDate: new Date(input.dueDate)`) inside `repository.ts` (`insert(input: CreateInvoiceBody)`), which is the only file allowed to know `InvoiceInsert`.

### 2. `server/src/platform/container.ts` - concrete SendGrid adapter constructed lazily in a getter, no override, no mock
- Problem: `get email()` does `new SendgridEmailSender(process.env.SENDGRID_API_KEY ?? '', 'billing@example.com')`. (a) `ContainerOverrides` has no `email`, so tests cannot swap it and the port is not really inverted - any test that calls `InvoiceService.create` will try to talk to SendGrid. (b) The API key is read from `process.env` with an empty-string fallback instead of the existing `SecretsProvider` (`this.secrets.get(...)`), so a missing key fails only at send time, after the invoice is already saved. (c) The sender address is a hardcoded literal.
- Fix: add `email?: EmailSender` to `ContainerOverrides`; build it in the constructor/getter as `overrides.email ?? new SendgridEmailSender(...)`, resolving the key through `secrets` and failing fast when it is absent; move the from-address to config/constants.

## Should fix

### 3. `server/src/adapters/mocks.ts` - no mock for the new port (file missing from the PR)
- Problem: a new integration needs all four pieces: port, concrete adapter, mock, container registration. The PR has port (`shared/adapters.ts`), adapter (`sendgrid.ts`) and container wiring, but `adapters/mocks.ts` is untouched - there is no `MockEmailSender`.
- Fix: add `MockEmailSender implements EmailSender` that records sent messages in an array, and use it through `ContainerOverrides.email` in the invoice service tests.

### 4. `client/src/vendor/shared/contracts/invoice.ts` - manual copy of the shared contract is out of sync (file missing from the PR)
- Problem: the server contract has `dueDate` in both `Invoice` and `CreateInvoiceBody`; the client copy does not. The shared contracts are duplicated by hand and the PR only updated the server side, so the client will strip/never send `dueDate`, and the create call will fail validation on the server.
- Fix: copy `server/src/vendor/shared/contracts/invoice.ts` to the client vendor folder byte-for-byte (and add `EmailSender`/`EmailMessage` only if the client needs them - it should not).

### 5. `server/src/modules/invoices/routes.ts` - route builds the persistence row
- Problem: the handler maps the request body into a DB insert shape, including data conversion (`new Date(body.dueDate)`). This is transformation logic that belongs below transport, and it is only needed because of finding 1. The route should parse, call one service method, and map to a status.
- Fix: after finding 1, `const invoice = await service.create(body); return reply.code(201).send(invoice);`. Also validate `:id` params with a schema rather than trusting the raw string.

## Minor / design notes

### 6. `server/src/modules/invoices/service.ts` - email sent inline after the insert
- Problem: if `email.send` throws, the request returns 500 although the invoice is already persisted (client may retry and create a duplicate). The email body formatting (`amountCents / 100`, raw `dueDate`) is also inline.
- Fix: decide the policy explicitly - catch and log the send failure (invoice creation succeeded) or enqueue the notification; move message building to `helpers.ts` (pure, testable). Not an onion violation, just robustness.

## Checked and fine
- `EmailSender`/`EmailMessage` port lives in `shared/adapters.ts` with no I/O; `sendgrid.ts` is the only file importing `@sendgrid/mail`; the service uses the port via `container.email`.
- `repository.ts` maps `$inferSelect` to the shared `Invoice` before returning, and keeps Drizzle contained.
- Shared contract imports only `zod`. `InvoiceService` takes the whole `Container` and constructs its own repository, matching repo convention. `routes.ts` imports no DB or SDK.
- Optional: the repository holds little logic, so a repository interface is not required yet.
