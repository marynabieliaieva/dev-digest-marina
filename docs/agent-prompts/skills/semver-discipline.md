---
name: semver-discipline
description: A breaking change must ship behind a version bump or a new route, never as a silent edit to the current one.
type: convention
---

# Semver discipline

This API has no runtime version negotiation — "the contract" is whatever the
current route currently returns, so a breaking change with no version signal
is invisible until a caller breaks in production. When the diff contains a
breaking change (see `breaking-change` / `response-schema`), check HOW it
ships:

- **CRITICAL** — the breaking change lands as an in-place edit to an existing,
  unversioned route/schema, with nothing in the diff that lets an existing
  caller opt out (no new path, no new field, no header-based negotiation).
- **WARNING** — a version bump or new route exists, but the old one is removed
  in the SAME diff instead of being kept alive for a transition window (see
  `deprecation-policy`).
- **Safe** — the breaking change is confined to a newly introduced
  `/v2/...` route (or equivalent), and the old route is untouched by this diff.

## Good — old route kept, new behaviour behind a new path

```ts
app.post('/payments', legacyCreatePaymentHandler);       // unchanged
app.post('/v2/payments', createPaymentHandlerV2);        // new required `currency`, no default
```

## Bad — the only route silently changes shape

```ts
// The diff edits src/api/payments/routes.ts in place: same path, same method,
// `currency` goes from optional-with-default to required. There is no /v2 and
// no fallback — every existing integration is affected the moment this ships.
app.post('/payments', { schema: { body: CreatePaymentBody } }, handler);
```

In the finding, state plainly that the diff has no version escape hatch, and
suggest the concrete alternative: a new route/version, a request header that
opts into the new shape, or reverting the field to optional until a version
boundary exists.
