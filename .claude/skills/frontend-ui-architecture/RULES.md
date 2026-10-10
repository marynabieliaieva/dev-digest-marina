# frontend-ui-architecture — authoring digest

Short rules for agents **writing** code (`implementer`). Reviewers use the full
skill ([SKILL.md](SKILL.md) and its linked files). Invoke the full skill instead
of this digest when the task creates a **new feature folder or route**, or
splits/moves existing components.

Placement (repo conventions win over generic advice):
- Route-scoped component → `client/src/app/<route>/_components/<PascalCaseName>/<Name>.tsx`
  (+ optional `<Name>.test.tsx`, `helpers.ts`, `styles.ts`).
- Shared/generic component (used by ≥2 routes/features) → `client/src/components/<kebab-case>/`.
- Shared data hook → one file per domain in `client/src/lib/hooks/<domain>.ts`
  (`agents.ts`, `reviews.ts`, …). Single-consumer hook → colocate with its component.
- Contracts → `client/src/vendor/shared` (manual copy of the server's `@devdigest/shared`).

Rules:
- Colocate by feature; don't promote to a shared folder until a second consumer exists.
- No deep cross-feature imports (one route reaching into another route's
  `_components/`/helpers) — promote the piece to the shared layer instead.
- No barrel `index.ts` that just re-exports a folder.
- Pure calculation/validation/formatting → a plain function in `helpers.ts`, not
  inside a component body or `useEffect`; hooks call those functions.
- Constants used by one component live next to it; `helpers.ts`/`utils` split by
  concern, never a junk drawer.
