# Prioritization rubric

Rank every finding with the same rule so reports are comparable between runs. Tiers are
**P0, P1, P2, Info** — use exactly these labels in section 4.

## Tiers

| Tier | Meaning | Typical triggers |
|---|---|---|
| **P0 — do now** | Active risk or blocker | `critical`/`high` vulnerability in a **prod** dependency with a fix available; AGPL/GPL license in code shipped to users; a module cycle that already breaks load order |
| **P1 — this sprint** | Large cheap win or real risk | unused prod dependency ≥ 5 MB that is safe to remove; `moderate` vuln in prod; duplicate of a ≥ 5 MB package that one bump collapses; a major version behind on a framework-level dep (`next`, `react`, `fastify`); **boundary bypass** — a relative import that reaches into another package's source instead of its alias/public entry (it silently couples two standalone packages and breaks when either moves) |
| **P2 — plan it** | Moderate value or needs design | unused dev dependency; heavy prod dep (≥ 15% of the package's prod closure) with a lighter or lazy-loadable alternative; **version drift** of an SDK across packages (one coordinated bump); minor/patch drift on many packages; module cycles that do not break loading; duplicates of small packages |
| **Info** | Hygiene, no action required | redundant explicit declaration (`requiredBy` non-empty), implicit tooling, `@types/*` mismatches, version-range style, missing `engines`/`packageManager`, intentional drift (e.g. a package pinned to zod 4 on purpose) |

## Impact × effort (to order inside a tier)

- **Impact** = MB saved ÷ package prod-closure total (use `totals`, never the sum of rows), one step
  up if it also removes a vulnerability.
- **Effort**: `S` = delete a line / bump a patch; `M` = code change in a few files or a minor upgrade
  with a changelog read; `L` = major upgrade, replacing a library, or an architecture change.
- Within a tier sort by impact desc, then effort asc.

## Checks before downgrading or dropping a finding

- `requiredBy` non-empty → removing the explicit entry will not shrink the install: report it as
  **Info** ("redundant declaration"), not as a size win.
- Dev-only packages never go above P2 unless they carry a vulnerability that runs in CI with secrets.
- A package used only through a CLI (`drizzle-kit`, `tsx`) is **not** unused; check `scripts`.
- Intentional drift: read comments in the package's own `package.json`/docs before calling drift a
  defect; if it is documented, it is **Info**.
- Offline run → vulnerability and freshness rows are "not checked", never "none found".

## Summary section — what belongs there

3–5 takeaways, ordered by tier then impact, each tied to a number and a file. Good: "Remove unused
`moment` from `server/package.json` (4.2 MB, never imported under `server/src`) — confirm, then
`pnpm remove moment`." Not good: "keep dependencies up to date".
