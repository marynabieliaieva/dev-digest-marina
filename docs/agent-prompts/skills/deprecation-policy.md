---
name: deprecation-policy
description: Anything removed from a public contract needs a deprecation window, not a disappearance.
type: convention
---

# Deprecation policy

A field, parameter, enum member, or route that this diff removes must have
been given a chance to die gracefully. Check the diff (and, if visible, recent
history) for evidence of a deprecation step BEFORE the removal:

- **CRITICAL** — a public field/parameter/route is removed in this diff with
  no prior deprecation: no `deprecated` marker, no warning response header, no
  changelog/doc entry, no grace-period window that shipped earlier.
- **WARNING** — a deprecation marker exists, but the diff removes the thing
  before the stated sunset date, or removes it for all callers at once instead
  of behind a flag/cohort.
- **Safe** — the diff only ADDS a deprecation marker (marks something
  deprecated but keeps it working), or removes something that was never part
  of the public contract (internal-only, never released).

## Good — marked deprecated first, removed later in a separate change

```ts
/** @deprecated Use `currency` instead. Removed after 2026-03-01. */
description: z.string().optional(),
currency: z.string().default('USD'),
```
then, in a LATER diff, once the sunset date has passed:
```ts
currency: z.string().default('USD'), // `description` removed per the 2026-03-01 sunset
```

## Bad — removed with no warning, in one diff

```ts
// before: { amount, currency, description }
// after:  { amount, currency }              -- `description` just disappears
```

Any caller still reading `description` gets `undefined` with no warning ever
issued that this was coming. In the finding, say what evidence of a
deprecation period is missing and suggest the minimal fix: reintroduce the
field as deprecated-but-present, add a `Deprecation`/`Sunset` response header,
or note the required lead time before it can be removed for real.
