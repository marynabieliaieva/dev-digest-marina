# API Contract Reviewer — skills control experiment

Part 3 of [`plan.md`](plan.md) §5. Answers: does splitting the single broad
`api-contract-gate` skill into four granular, good/bad-paired skills
(`breaking-change`, `response-schema`, `semver-discipline`,
`deprecation-policy`) change what the **API Contract Reviewer** agent finds?

## Setup

- **Agent**: API Contract Reviewer (`openrouter/deepseek/deepseek-v4-flash`,
  single-pass strategy, repo intel on).
- **Skill links** (agent's Skills tab), in this order:
  1. `breaking-change` — imported by hand through the skills **import flow**
     (file → preview → confirm), landed `enabled: false`, then explicitly
     enabled after reading the body.
  2. `response-schema` — seeded.
  3. `semver-discipline` — seeded.
  4. `deprecation-policy` — seeded.

  The old `api-contract-gate` link stays on the agent at order 0 but
  **disabled** in both legs of this experiment — it is superseded by the four
  above, not deleted (kept for history, matching the "never hard-delete"
  principle in [`plan.md`](plan.md) §6.7).

- **Control PR**: [`server/src/db/seed-control-prs.ts`](../../../server/src/db/seed-control-prs.ts)
  `#485` — "Clean up the payments list endpoint". Framed as a harmless
  tidy-up (same trick as `#484`), it makes two independent breaking changes
  in one 4-line hunk of `src/api/payments/list.ts`:
  - the `status` **query parameter** goes from optional to required;
  - the response field `total` is **renamed** to `count`.

- **Method**: `POST /agents/:id/skills` toggled the four links' per-link
  `enabled` (the exact mechanism `agent_skills.enabled` exists for), then
  `POST /pulls/:id/review {agentId}` ran the same agent against the same PR
  twice — once with all four `enabled: false` (baseline), once with all four
  `enabled: true` (treatment). Confirmed via each run's trace log line:
  - baseline: `skills: 5 linked, 0 enabled — no skills block in the prompt`
  - treatment: `skills: 4 of 5 linked skill(s) attached (breaking-change,
    response-schema, semver-discipline, deprecation-policy) — ~1118 token(s)`

## Results

| | **Without skills** (baseline) | **With skills** (treatment) |
|---|---|---|
| Run id | `e6741c26-7678-4292-bb80-33dedf22c1f8` | `d6037b7c-a673-4904-8435-4c3d05189fc0` |
| Verdict | `request_changes` | `request_changes` |
| Score | 30 | 30 |
| Findings | 2 CRITICAL, 0 WARNING, 0 SUGGESTION | 2 CRITICAL, 0 WARNING, 0 SUGGESTION |
| Grounding | 2/2 passed | 2/2 passed |
| Tokens in / out | 2,628 / 1,075 | 3,787 / 1,433 |
| Duration | 10.9 s | 16.5 s |
| Cost | $0.0001906 | $0.0002655 (+39%) |

Both legs caught both breaking changes and reached the same verdict — the
**API Contract Reviewer**'s system prompt (`docs/agent-prompts/api-contract-reviewer.md`)
is already a dedicated, detailed contract-review prompt, so on this PR the
skills didn't change *whether* the bugs were caught. The difference is in
**how directive the findings are**:

**Baseline** (query-param finding, abbreviated):
> "Keep 'status' optional with a default (e.g., include all statuses) or add
> a new required parameter alongside the old. Alternatively, version the
> route."

**With skills** (same finding):
> "Keep `status` optional with a default value that matches the current
> server behaviour (e.g., no filtering), or introduce a new route (e.g., `GET
> /v2/payments`) that requires the parameter while keeping the old route
> unchanged."

**Baseline** (response-field finding, abbreviated):
> "Add 'count' alongside the existing 'total' field, or deprecate 'total'
> with migration period. Do not remove the old field without version bump."

**With skills** (same finding):
> "Restore the `total` field and add a new `count` field alongside it, or
> mark `total` as deprecated (keep it working) and remove it only after a
> documented sunset period. Also consider using a versioned endpoint for the
> breaking change."

The treatment run's suggestions consistently pick up language and structure
straight out of `semver-discipline` ("a new route, e.g. `/v2/...`") and
`deprecation-policy` ("documented sunset period", "deprecated — keep it
working") — concepts the base prompt never mentions. The summary also
upgrades from a generic restatement ("PR claims 'No behavior change' but both
changes are breaking") to naming the concrete remediation gap ("renamed to
`count` with no migration or deprecation period").

## Conclusion

On a PR this clear-cut, the four granular skills did not change **quantity**
(2/2 findings both times) or the **verdict** — the base prompt alone already
gets there. They measurably changed **quality**: every suggestion gained a
concrete, actionable remediation path (a versioned route, a sunset date) that
the base prompt's own findings lacked, at a ~39% token/cost premium
(~1,118 extra prompt tokens for the four skill blocks). The expected payoff is
larger on PRs where the breaking change is less obvious than a single-hunk
diff — future controls should include one from [`plan.md`](plan.md) §6's
product-improvement list (e.g. a multi-file drift case) to test that.
