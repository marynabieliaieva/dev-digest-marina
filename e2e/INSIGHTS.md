# INSIGHTS.md — @devdigest/e2e

Append-only. Read before starting work in this package. Updated by the
`engineering-insights` skill — only when a session learns something
non-obvious; never rewritten, only appended to.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- 2026-10-12 — agent-browser's default window is ~568px tall and `find text|role … click`
  does not scroll to its target: a card/checkbox below the fold gives "Element not found" (CI) or
  "Done" with no effect (local). `run.ts` now sets a 1440x3200 viewport once per run; don't add
  scroll steps to specs. A direct `click '<css>'` does auto-scroll, but `find …` does not.
- 2026-10-12 — `find role button --name "X"` matches the first same-named button even if it sits
  behind a modal overlay ("covered by <div>"). Scope with `find last "[role=dialog] button" click`.
- 2026-10-12 — Pin agent-browser in CI (`e2e-web.yml`). The unpinned install floated to a newer
  release and `find role checkbox --name <doc>` stopped matching (flows 11/12) while 0.38.1 passed.
- 2026-10-12 — A click on a `disabled` button still reports "Done". Conventions cards share ONE
  `useUpdateConvention` mutation, so `pending` disables every card's Accept until the PATCH returns;
  a back-to-back second Accept was silently dropped on slower CI. Wait for the first action to
  settle (count text + an enabled button via `wait --fn`) before the next click.

## Decisions

## Recurring Errors & Fixes

## Session Notes

## Open Questions
