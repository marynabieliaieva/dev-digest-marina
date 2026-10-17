# Eval Pipeline (L06) — pointer

The Eval Pipeline spec (SPEC-03) adds regression protection for review agents.
Accepted and dismissed findings become frozen eval cases (`must_find` /
`must_not_flag`). An agent runs on its whole case set as one batch, and
code-only scoring (no LLM) measures recall, precision and citation_accuracy.
Run history, a regression banner, a Compare view of two runs (including the
system-prompt diff) and a workspace Eval Dashboard show whether a change helped.
`pnpm verify:l06` is the feature's test gate.

This file is only the homework checker's entry point. The full specification
lives in [specs/2026-10-15-eval-pipeline/spec.md](2026-10-15-eval-pipeline/spec.md).
