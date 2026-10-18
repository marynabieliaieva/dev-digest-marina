---
name: dependency-checker-lite
description: >
  EVAL-ONLY control variant of dependency-checker (a deliberately weakened copy used to prove the
  evals can tell a stronger skill from a weaker one). Do not use for real requests — use
  dependency-checker instead. Audits the repository's dependencies and writes a five-section report.
version: "0.1.0"
---

# Dependency Checker (lite)

Audit the repo's dependencies and write a report.

## Report sections

1. **Scope** — which packages were analyzed.
2. **Dependency graph** — a Mermaid `flowchart` of how the packages depend on each other.
3. **Size breakdown** — a table of dependencies and their installed size.
4. **Findings & Priorities** — list what you found (unused packages, duplicates, outdated versions)
   and order the list so the most important comes first.
5. **Summary** — a few takeaways for the developer.

Gather the data with the tools you have, or use the data you were given.
