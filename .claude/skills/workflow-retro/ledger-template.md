# Retro: <label>   |   <YYYY-MM-DD>   |   Workflow: <e.g. /run-plan + /pr-self-review>

Inputs: <plan / spec / flags>   ·   Data source: in-context | in-context + --deep (session <id>, since <ISO>)

## 1. Run facts

- Wall time: <start → end, duration>
- Agents: <n> (peak parallel <p>). By type: <type × count>
- Tokens: total <T> (main <M>, subagents <S>); fresh input + output <F>, cache reads <C>. Source: <…>
- Top 3 agents by tokens: <agent — tokens — why>
- Loops: verification <used>/<cap>, architecture <used>/<cap>, final run <used>/<cap>, review <…>. Caps hit: <…>
- Human interventions: <n> — <one line each>

### Timeline

| # | Wave / phase | Agent (type) | Task / purpose | Outcome | Tokens | Duration |
|---|---|---|---|---|---|---|

## 2. Quality metrics

- First-pass yield: <x>% (<green first time>/<tasks>)
- Rework ratio: <fix-task tokens ÷ original-task tokens>
- Evidence reuse: <accepted by fingerprint> / <re-run>
- Environment vs product: <n env issues, cost> vs <n product defects>

### Defect escape matrix

| Defect | Introduced in | Should have been caught by | Caught by | Why it slipped |
|---|---|---|---|---|

## 3. Insights per agent type

### <agent type>
- Hard: …
- Easy: …
- Duplicated: …
- Missed: …

## 4. Module insights

- server: …
- client: …
- reviewer-core: …
- e2e: …
- tooling: …

Suggested engineering-insights entries: <package — one line each, or "none">

## 5. Proposals

| # | Target (file) | Change | Evidence | Expected effect | Effort | Status |
|---|---|---|---|---|---|---|

`Status`: proposed | accepted | rejected | applied (<commit>). Update it in later retros.

## 6. Trend

<comparison with earlier entries for the same workflow, or "first entry">
