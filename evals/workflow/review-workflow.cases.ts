import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + nested package
 * CLAUDE.md/AGENTS.md + skills + subagents, loaded via settingSources:["project"]) behaves as
 * documented. Organized by scenario, not by a single artifact, because these behaviors are
 * cross-cutting.
 *
 * Budget: 4 Claude sessions total (merged from 5 + the planned extras).
 *   - 2 × trace     → 1 session each; each folds SEVERAL assertions into one session = 2
 *   - 1 × discovery pair (positive trace on INSIGHTS.md + near-miss negative activation)   = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in. Every listed expectation must hold, so keep each trace to a handful of facets
 * that ONE natural prompt reliably triggers — too many in one session turns into flakiness.
 *
 * What the nested-CLAUDE.md traces rely on: every package's CLAUDE.md is just `@AGENTS.md`, and
 * each AGENTS.md says "Read INSIGHTS.md before starting work here". Those nested files are loaded
 * lazily, only when the agent touches a file inside that package — so the prompts below name
 * source files in each package (never the INSIGHTS.md files themselves) and the assertion is that
 * the agent follows the nested instruction on its own.
 *
 * (CI smoke: this comment was touched to exercise .github/workflows/evals.yml.)
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): nested CLAUDE.md in 3 packages + subagent dispatch, together ----------
  {
    kind: "trace",
    name: "multi-package task loads client/server/reviewer-core nested rules AND pulls the architecture-reviewer",
    prompt:
      "Я планую зміну, що зачіпає три пакети: новий хук у client/src/lib/hooks/reviews.ts, новий " +
      "метод у server/src/modules/reviews/service.ts і правку у reviewer-core/src/grounding.ts. " +
      "Розпочни з того, що відкриєш ці три файли й дотримаєшся настанов цього репо для кожного пакета. " +
      "Потім ОБОВʼЯЗКОВО запусти сабагента architecture-reviewer, щоб він оцінив мій план на " +
      "відповідність архітектурним межам — не рецензуй сам.",
    expectFilesRead: ["client/INSIGHTS.md", "server/INSIGHTS.md", "reviewer-core/INSIGHTS.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 12,
  },

  // --- trace (1 session): nested CLAUDE.md in the two small packages ----------------------------
  {
    kind: "trace",
    name: "mcp and e2e tasks load their own nested rules",
    prompt:
      "Мені треба зробити дві дрібні правки: у mcp/src/tools/get-conventions.ts і додати новий flow " +
      "поруч із e2e/specs/01-app-boot.flow.json. Перш ніж щось міняти, відкрий ці файли й дотримайся " +
      "настанов цього репо для кожного з двох пакетів. Нічого не редагуй — лише підготуйся.",
    expectFilesRead: ["mcp/INSIGHTS.md", "e2e/INSIGHTS.md"],
    maxTurns: 8,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    // Trace, not activation: the model goes straight to the package's INSIGHTS.md (via the nested
    // AGENTS.md rule or the skill — the trace cannot tell which), so what we can assert reliably is
    // that a genuine discovery is routed to the right file. See the negative case below for the
    // skill-must-not-fire side.
    kind: "trace",
    name: "a genuine discovery in server/ is routed to server/INSIGHTS.md",
    prompt:
      "Щойно виправив баг у server/: pgvector-запит повертав нуль рядків, бо розмірність колонки не " +
      "збіглася після зміни моделі ембедингів. Це неочевидна пастка — зафіксуй цей урок у нотатках " +
      "пакета server, щоб команда більше на неї не наступала.",
    expectFilesRead: ["server/INSIGHTS.md"],
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
