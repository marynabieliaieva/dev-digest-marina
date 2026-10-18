# Architecture review: invoices + email notification PR

Scope: files in `fixtures/invoices-pr/CHANGED.txt`, plus the unlisted `client/src/vendor/shared/contracts/invoice.ts` and `server/src/adapters/mocks.ts` that the PR touches or should have touched.

Overall: the email sender is correctly modelled as a port (`EmailSender` in shared, `SendgridEmailSender` as adapter). The problems are in how it is wired, and in what the service layer depends on.

## 1. Service depends on the Drizzle schema (infrastructure leak into application layer)
**File:** `server/src/modules/invoices/service.ts` (lines 3, 13)

`service.ts` imports `invoices` from `db/schema/invoices.js` and uses `typeof invoices.$inferInsert` as the type of `create()`'s argument. The application layer is now coupled to the table definition, so any column change ripples into the service and the route.

**Fix:** Define a domain/contract input type (e.g. `NewInvoice` in `@devdigest/shared`, or derive it from `CreateInvoiceBody`) and use it in `service.create`. Keep `$inferInsert` private to `repository.ts`, which maps `NewInvoice` to the row insert.

## 2. Container hard-wires the SendGrid adapter and bypasses the secrets port
**File:** `server/src/platform/container.ts` (lines 6-8, 18-21)

- `process.env.SENDGRID_API_KEY ?? ''` is read directly. The container already has a `SecretsProvider` for this. An empty-string fallback also means a missing key is silently accepted and only fails at send time.
- The sender address `billing@example.com` is hardcoded in the composition root.
- `ContainerOverrides` only allows overriding `secrets`, so tests cannot inject a fake `EmailSender`. A `MockEmailSender` is also not added to `server/src/adapters/mocks.ts` next to `MockSecretsProvider`. Every invoice test would either hit the real SendGrid SDK or need module mocking.
- `email` is a lazy getter, unlike `secrets`, so config errors only surface on the first invoice.

**Fix:** Add `email?: EmailSender` to `ContainerOverrides`; build the sender from `await secrets.get('SENDGRID_API_KEY')` and a config value for `from`; fail fast if missing; add `MockEmailSender` (records sent messages) to `adapters/mocks.ts`.

## 3. Service takes the whole Container (service locator) and builds its own repository
**Files:** `server/src/modules/invoices/service.ts` (lines 9-11), `server/src/modules/invoices/routes.ts` (line 6)

`InvoiceService` receives the entire `Container` and does `new InvoiceRepository(container.db)` itself. Dependencies are hidden (the constructor signature doesn't say it needs email), the service can't be unit-tested without a full container and a DB, and the service hard-codes a concrete repository. Routes also construct the service with `new`, so the wiring is spread across layers.

**Fix:** Inject exactly what is needed: `new InvoiceService({ repo, email })` (repository as an interface or at least a constructor parameter). Compose it in the container / module registration, and have routes receive the ready service.

## 4. Email is sent inline after insert with no failure handling
**File:** `server/src/modules/invoices/service.ts` (lines 14-19)

The invoice is persisted and then `email.send` is awaited in the same request. If SendGrid fails, `create` throws, the client gets a 500, but the invoice already exists, so a retry creates a duplicate. The email is also a slow external call on the critical path.

**Fix:** Decide the semantics explicitly. Either treat notification as best-effort (try/catch, log, still return 201), or record an outbox row / emit a domain event and send from a background handler with retries. At minimum, do not let a notification failure turn a successful create into an error.

## 5. Presentation/formatting logic and a money bug inside the service
**File:** `server/src/modules/invoices/service.ts` (line 18)

The service composes the email body, including `invoice.amountCents / 100` (float division, no fixed decimals, so `1050` renders as `10.5`) and a raw ISO date string. Message templating is a separate concern from invoice use cases.

**Fix:** Move message building to a small helper/template (e.g. `modules/invoices/helpers.ts`) that formats currency with `Intl.NumberFormat` and dates properly; the service only calls it.

## 6. Repository returns the transport (Zod/wire) type
**File:** `server/src/modules/invoices/repository.ts` (lines 4, 9-16)

The repository maps rows straight to the shared API contract `Invoice` (ISO strings). The persistence layer is therefore shaped by the wire format, and the service/domain never sees real `Date` values. It also forces `dueDate.toISOString()` here.

**Fix:** Return a domain `Invoice` (with `Date`s) from the repository and map to the wire contract in the route (or a mapper). Acceptable as a pragmatic shortcut only if the team's convention explicitly allows it; flag it if not.

## 7. Route validates, but date parsing is unchecked and mapping lives in the route
**File:** `server/src/modules/invoices/routes.ts` (line 14)

`new Date(body.dueDate)` on a free-form `z.string()` yields `Invalid Date` for bad input, which then reaches Drizzle and produces a 500 instead of a 400. Contract `dueDate: z.string()` is unvalidated.

**Fix:** Make the contract `z.string().datetime()` (or `z.coerce.date()`), so validation fails at the boundary with a 400, and let the service accept the already-typed value.

## 8. Client copy of the shared contract has drifted from the server
**File:** `client/src/vendor/shared/contracts/invoice.ts`

The client `Invoice` has no `dueDate`, and `CreateInvoiceBody` has no `dueDate`, while the server contract requires it. The file is not in `CHANGED.txt`, so the PR ships contracts that disagree: a client built from this copy will POST bodies the server rejects with 400, and will drop `dueDate` from responses. The two files are hand-duplicated with no sync mechanism.

**Fix:** Update the client copy in this PR; better, make `vendor/shared` a single source (path alias or a sync script/CI check) so the copies cannot diverge.

## 9. SendGrid adapter configures a process-global singleton in its constructor
**File:** `server/src/adapters/email/sendgrid.ts` (lines 5-7)

`sgMail.setApiKey` mutates module-global state in the constructor, so two instances share one key, and constructing with `''` silently "succeeds". Also `text`-only body, no error mapping to a domain error.

**Fix:** Use `new MailService()` from `@sendgrid/mail` per instance, validate a non-empty key, and wrap SDK errors in an adapter-level error so the service never sees SendGrid types.

## Minor
- `markPaid` is not idempotent: calling it twice overwrites `paidAt`. Guard with `where paidAt is null` or return the existing value.
- No tests are included for the new module or the adapter.

## What is fine
- `EmailSender`/`EmailMessage` port lives in shared and the service uses it via the interface, not the SDK.
- The SDK import is confined to `adapters/email/sendgrid.ts`.
- Routes do not touch the DB or SDK directly.
