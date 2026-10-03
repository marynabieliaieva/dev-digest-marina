---
name: breaking-change
description: Flag any change to an existing endpoint's parameters that an unchanged caller cannot survive.
type: convention
---

# Breaking parameter changes

Compare every route's parameters (path, query, body) against their PREVIOUS
form. A change is CRITICAL when an existing caller that does not change its
request will start failing or silently receive different behaviour:

- an optional parameter becomes required, or a required one is added with no
  default;
- a parameter is removed or renamed (the old name simply stops working);
- a type is narrowed — `string` → enum, nullable → non-null, a wider numeric
  range → a narrower one;
- a default value changes, so a request that omits the field now behaves
  differently than before.

A new, entirely optional parameter, or a parameter added to a brand-new route,
is never a breaking change — do not report it.

## Good — stays backward compatible

```ts
const CreatePaymentBody = z.object({
  amount: z.number().int().positive(),
  currency: z.string().default('USD'), // existing callers who omit it: unaffected
  memo: z.string().optional(), // new, optional: unaffected
});
```

## Bad — silently breaks an existing caller

```ts
const CreatePaymentBody = z.object({
  amount: z.number().int().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']), // was optional+defaulted, now REQUIRED
});
```

A client that used to POST `{ amount: 500 }` and get USD now gets a 422 with no
code change on its side. In the finding, name the exact old shape, the exact
new shape, and the request that used to work and no longer does. Prefer the
fix that keeps the field optional with its old default, or adds a new field
alongside rather than repurposing the existing one.
