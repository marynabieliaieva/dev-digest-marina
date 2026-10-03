---
name: response-schema
description: Compare the response shape and status code an endpoint returns against its previous contract.
type: convention
---

# Response schema stability

A caller binds to the RESPONSE shape as tightly as to the request. For every
route the diff touches, diff the OLD response against the NEW one:

- **CRITICAL** — a response field is removed, renamed, or changes type; a
  success status code changes (200 → 201, 200 → 204); a field that was always
  present becomes conditionally absent; an array becomes wrapped in an object
  or vice versa.
- **WARNING** — a new field is added inside an object a caller might
  destructure with a strict shape check, or nesting changes in a way that is
  additive but still surprising (e.g. flattening one level deeper).
- **Safe** — a genuinely new, additional field on an existing response; a new
  endpoint's response shape (nothing depended on it yet).

## Good — additive, same status code

```ts
// before: { id, amount, currency }
// after:  { id, amount, currency, memo }  — new field, nothing removed
reply.status(200);
return { id: row.id, amount: row.amount, currency: row.currency, memo: row.memo };
```

## Bad — field renamed and status code changed

```ts
// before: reply.status(200); return payment;                     // { id, amount, currency, description }
// after:
reply.status(201);
return { payment: { id: row.id, amount: row.amount, currency: row.currency, memo: row.memo } };
```

Two breaks in one diff: `description` became `memo` (a client reading
`payment.description` now gets `undefined`), the payload moved under a
`payment` wrapper (a client reading top-level fields now gets `undefined` for
all of them), and the status code moved from 200 to 201 (a client checking
`res.status === 200` now treats a successful call as a failure). Call out each
one separately with the exact old field/status and the exact new one, and
suggest keeping the old shape available (a new field alongside, or a new
route/version) rather than replacing it in place.
