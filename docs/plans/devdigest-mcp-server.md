# Development Plan: devdigest MCP server (локальний stdio, пакет `@devdigest/mcp`)

> Перший крок після затвердження — зберегти цей план у `docs/plans/devdigest-mcp-server.md` (конвенція planner/implementer).
> Нижче плану — додаток із кращими практиками (research).

## Context
Хочемо дати Claude Code (та іншим MCP-клієнтам) доступ до devdigest: список рев'юерів, запуск рев'ю на PR, findings, conventions репо, заглушка blast radius. Лише локально, stdio, мінімум токенів на старті чату.

**Рішення користувача**
- `run_agent_on_pr` — **блокуючий**, ліміт 120 с; після ліміту повертає `{status:'running', run_id}`.
- MCP — тонка **HTTP-обгортка** над API `:3001`; код — **новий пакет `mcp/`**.
- **Оркестрація — у server** (onion): пошук репо/PR, автосинк, анти-дублі, «останній review PR» живуть у `ReviewService`/`PullsService`, а не в MCP.
- Відповіді нових роутів — **Zod-контракти в `server/src/vendor/shared/contracts`**; MCP тримає легкі локальні типи-дзеркала (zod 4). У `client/` не копіюємо (клієнт ці роути не використовує).
- Dedup **без head SHA** (без міграції): той самий PR + агент з активним раном → reuse.
- Агент: в описі просимо id з `list_agents`; server приймає й name як fallback; `all=true` — усі enabled.
- Не синхронізований PR — автосинк (репо має бути вже доданий у devdigest).

**Requirements:** R1 list_agents · R2 run_agent_on_pr · R3 get_findings (`run_id` | `repo+pr`, concise/detailed, offset/limit, фільтри) · R4 get_conventions · R5 get_blast_radius (stub, не-error placeholder) · R6 протокол/якість (4 принципи, annotations, instructions, без outputSchema/structuredContent, stdout = протокол, cap ~8k токенів, progress, статус лише вперед) · R7 `.mcp.json` + docs · R8 тести.

## Ключові рішення
| # | Рішення | Чому |
|---|---|---|
| D1 | npm у `mcp/` | як `reviewer-core`/`e2e` (не-app пакети) |
| D2 | `@modelcontextprotocol/server` v2 + zod ^4.2, tsx, vitest | окремий пакет → без конфлікту з zod 3 у server |
| D3 | Імена з префіксом `devdigest_*` | неймспейс і в клієнтах, що не додають `mcp__server__` |
| D4 | Відповідь лише `content[].text` (компактний markdown), без outputSchema/structuredContent | Claude Code інакше показує моделі лише structuredContent |
| D5 | Оркестрація в server (`ReviewService.runByRef`, `latestByRef`, `RepoService.resolve`) | onion: бізнес-правила в service; логіка доступна UI/CI; тестується на БД |
| D6 | Синк PR і підтягування файлів PR винести з `pulls/routes.ts` у новий `pulls/service.ts` + `pulls/repository.ts` (поведінка роутів без змін) | зараз роут ходить у `container.db` напряму (антипатерн); потрібне перевикористання з `ReviewService` (`new PullsService(container)`) |
| D7 | Dedup у server: активний ран того ж PR + agent → `reused: true` | без міграції `head_sha` |
| D8 | MCP поллить `GET /runs/:id` кожні 2 с до 120 с, шле progress | stdio без SSE; progress тримає idle-таймери |
| D9 | Cap відповіді 32 000 символів (~8k токенів), обрізання з підказкою | CC warning 10k, ліміт 25k |
| D10 | Логи лише stderr, без console.log | stdout = протокол |
| D11 | Запуск: `node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts` | `npm run`/`npx` пишуть у stdout; `.cmd`-шими на Windows |

## Нові server-роути і контракти
Контракти: новий файл `server/src/vendor/shared/contracts/review-refs.ts` (+ експорт з barrel `vendor/shared/index.ts`): `RepoRef`, `ReviewByRefRequest`, `ReviewByRefResponse`, `RunDetail`, `RunStatus`.

```
GET  /repos/resolve?repo=<owner/name | name>                 (repos)
     200 RepoRef { id, full_name } · 404 "not added to devdigest" · 409 ambiguous name → список owner/name
POST /reviews/by-ref  body ReviewByRefRequest { repo, pr, agent?, all? }   (reviews; rate limit 10/хв як у POST /pulls/:id/review)
     → RepoService.resolve → PullsService.findOrSync(repo, number) (lookup; якщо нема — синк з GitHub; підтягнути файли PR)
     → резолв агента (id, fallback name; disabled → 422) → dedup активних ранів → існуючий runReview
     200 ReviewByRefResponse { pr: {id, number, title, repo_full_name}, runs: [{run_id, agent_id, agent_name, reused}] }
     404 repo/PR/agent (повідомлення з наступним кроком) · 400 нема agent і all · 429
GET  /runs/:id                                                (reviews)
     200 RunDetail { run: {run_id, status, error, agent_id, agent_name, model, ran_at, duration_ms, pr_number, repo_full_name}, review: {verdict, score, summary, findings[]} | null }
     404 / 422
GET  /reviews/latest?repo=&pr=                                (reviews)
     200 RunDetail[] — останній ран кожного агента для PR · 404 repo/PR
```
Факт: run-executor зберігає review (run-executor.ts:254) ДО статусу `done` (:279) → `done` гарантує наявність review. Статуси: `running|done|failed|cancelled`.

## Що робить кожен tool (MCP)
- **devdigest_list_agents** — `GET /agents`; enabled першими; рядок: `name · id · model · enabled — опис≤100`. Без system_prompt.
- **devdigest_run_agent_on_pr(repo, pr, agent?, all?)** — `POST /reviews/by-ref` → поллінг `GET /runs/:id` для кожного рану (спільний дедлайн 120 с, `advanceStatus`, progress якщо є progressToken; abort зупиняє поллінг, ран не скасовує) → спільний форматер. Таймаут → НЕ error: `{status:'running', run_id}` + «call devdigest_get_findings later».
  ```
  octocat/hello#42 · security-reviewer · run 5e0d… — DONE
  Verdict: request_changes · Score: 42/100 · 1 CRITICAL · 2 WARNING · 4 SUGGESTION
  - [CRITICAL] src/auth/session.ts:41 — Access token written to logs. Token value is passed to logger.info.
  Showing 7 of 7. response_format:'detailed' adds suggestion, confidence, ids.
  ```
- **devdigest_get_findings(run_id | repo+pr, response_format, severity?, file?, offset=0, limit=20≤100)** — `GET /runs/:id` або `GET /reviews/latest`; running/failed/cancelled → текст-стан (не error); done → шапка з лічильниками по всіх, фільтри, сорт CRITICAL→WARNING→SUGGESTION→file→line, футер «Showing N of M; next offset=…». concise: severity, title, file:line, rationale (≤300); detailed: + suggestion, confidence, ids, line range. Нема ні run_id, ні repo+pr → isError з підказкою.
- **devdigest_get_conventions(repo, response_format)** — `GET /repos/resolve` → `GET /repos/:id/conventions`; concise: rule, file, confidence, accepted (без snippet); detailed: + evidence_snippet (fenced, ≤300). Нема скану → підказка запустити скан в UI (не error).
- **devdigest_get_blast_radius(repo?, pr?)** — без HTTP; не-error `{status:'not_implemented'}` + «note the limitation and continue».

## Descriptions (англ. — мова моделі)
- server `instructions`: "devdigest: local AI PR review. List reviewer agents, run a review on a GitHub PR, read findings and repo conventions."
- `devdigest_list_agents`: "List the reviewer agents configured in DevDigest (id, name, model, enabled). Call this first to get a valid agent id for devdigest_run_agent_on_pr — do not guess or invent agent ids."
- `devdigest_run_agent_on_pr`: "Run one reviewer agent on a pull request and return the result. This is a single call that triggers the review, waits for it to finish, and returns the verdict and findings — you do not need to poll. Requires a valid agent id from devdigest_list_agents — do not guess it. If the review takes longer than ~2 min it returns {status:'running', run_id}; call devdigest_get_findings with that run_id later."
  - `repo`: "Repository as owner/name (e.g. octocat/hello), or just the name if unambiguous." · `pr`: "Pull request number (e.g. 42), not an internal id." · `agent`: "Agent id from devdigest_list_agents. Do not guess — list agents first." · `all`: "Run all enabled agents instead of one."
- `devdigest_get_findings`: "Get the verdict and findings of an already-completed review run. Provide either run_id, or repo + pr. Defaults to a concise summary (top findings + counts by severity); pass response_format:'detailed' for full fields, and use offset/limit to page through large result sets."
  - `run_id`: "Run id from devdigest_run_agent_on_pr. Prefer this when you have it." · `repo`/`pr`: "Alternative to run_id: identify the PR by repo (owner/name) and pr number; returns the latest review." · `response_format`: "concise (default): severity, title, file:line, rationale. detailed: also suggestion, confidence, ids, line range." · `offset`/`limit`: "Pagination over findings; defaults keep the response small."
- `devdigest_get_conventions`: "Get the coding conventions extracted for a repository (rule, file, confidence, accepted). Use this to justify or check a finding against the repository's house rules."
- `devdigest_get_blast_radius`: "STUB — not yet implemented. Intended to map which files and symbols a PR's changes affect. Returns a placeholder, not real data. Do not rely on its output and do not block your report on it — note the limitation and continue."

Annotations: list/get* — `readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false`; run — `readOnlyHint:false, destructiveHint:false, idempotentHint:true (dedup), openWorldHint:true`.

## Tasks
| Task | Що | Depends | Owned paths | Skills | Done-condition |
|---|---|---|---|---|---|
| T1 | Контракти `contracts/review-refs.ts` + barrel; `GET /runs/:id` (запит review за `run_id` у `repository/review.repo.ts`, join PR/репо у `run.repo.ts`); it-тест: done+review, running без review, 404 чужий ws, 422 | — | `server/src/vendor/shared/contracts/review-refs.ts`, `vendor/shared/index.ts`, `server/src/modules/reviews/{routes,service,helpers}.ts`, `reviews/repository/{run,review}.repo.ts`, `server/test/runs-get.it.test.ts` | zod, onion-architecture, fastify-best-practices, security, engineering-insights | `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run runs-get.it.test` |
| T2 | `RepoService.resolve(owner/name | name)` + `GET /repos/resolve` (404/409); винести синк PR і fetch файлів PR з `pulls/routes.ts` у новий `PullsService` + `pulls/repository.ts` (`findByNumber`, `syncFromGitHub`, `refreshFiles`, `findOrSync`); роути `GET /repos/:id/pulls`, `GET /pulls/:id` — тонкі, поведінка без змін | — | `server/src/modules/repos/{routes,service,repository}.ts`, `server/src/modules/pulls/{routes,service,repository}.ts`, `server/test/repo-resolve.it.test.ts`, `server/test/pulls-service.it.test.ts` | onion-architecture, fastify-best-practices, drizzle-orm-patterns, security, engineering-insights | `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run repo-resolve.it.test pulls-service.it.test` + наявні pulls-тести зелені |
| T3 | `ReviewService.runByRef` (resolve → findOrSync → резолв агента id/name → dedup → `runReview`) і `latestByRef`; роути `POST /reviews/by-ref` (rate limit 10/хв), `GET /reviews/latest`; it-тест: reuse активного рану, disabled агент, PR не знайдено, all=true з частково активними | T1, T2 | `server/src/modules/reviews/{routes,service}.ts`, `reviews/repository/run.repo.ts` (active by PR+agent), `server/test/review-by-ref.it.test.ts` | onion-architecture, fastify-best-practices, security, engineering-insights | `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run review-by-ref.it.test` |
| T4 | Scaffold `mcp/`: package.json (npm, ESM, node≥22, scripts start/test/typecheck), tsconfig без alias на shared, `config.ts` (DEVDIGEST_API_URL, timeouts), `api/client.ts` (порт `DevdigestApi` + fetch-адаптер: listAgents, resolveRepo, reviewByRef, getRun, latestReview, getConventions; таймаути, encodeURIComponent, `ApiError.kind`), `api/types.ts` (дзеркала контрактів), `lib/` (toolText/toolError, apiErrorToTool з підказкою `./scripts/dev.sh`, capResponse, stderr log, fence, advanceStatus), `server.ts` (`createMcpServer`, instructions); CLAUDE/AGENTS/INSIGHTS/README | — | `mcp/**` крім `src/tools`, `src/format`, `src/index.ts` | onion-architecture (порт/адаптер), security, typescript-expert, engineering-insights | `cd mcp && npm install && npm test && npm run typecheck` |
| T5 | `devdigest_list_agents`, `devdigest_get_conventions`, `devdigest_get_blast_radius` + `*.schema.ts`; тести: system_prompt не у виводі, stub не викликає HTTP і не isError | T4 | `mcp/src/tools/{list-agents,get-conventions,get-blast-radius}*`, тести | zod, security, engineering-insights | `cd mcp && npm test && npm run typecheck` |
| T6 | `devdigest_get_findings` + `format/findings.ts` (спільний форматер); тести: run_id vs repo+pr, сорт, offset/limit, concise vs detailed, cap | T4 | `mcp/src/tools/get-findings*`, `mcp/src/format/findings.ts`, тести | zod, security, engineering-insights | `cd mcp && npm test && npm run typecheck` |
| T7 | `devdigest_run_agent_on_pr`: виклик by-ref + поллінг (інжектовані sleep/now), спільний дедлайн, progress лише з токеном, abort, таймаут → не-error running+run_id, 429/404 → isError з наступним кроком | T4, T6 | `mcp/src/tools/run-agent-on-pr*`, тести | zod, security, engineering-insights | `cd mcp && npm test && npm run typecheck` |
| T8 | `src/index.ts` (stdio, `fileURLToPath` entrypoint), `tools/index.ts` (детермінований порядок), `protocol.test.ts` (in-memory: 5 tools, без outputSchema, annotations, desc ≤ ~450 симв., tools/list JSON ≤ 8000 симв., instructions), `.mcp.json`, root `AGENTS.md`/`README.md` | T5, T6, T7 | `mcp/src/index.ts`, `mcp/src/tools/index.ts`, `mcp/test/protocol.test.ts`, `.mcp.json`, `AGENTS.md`, `README.md` | security, engineering-insights | `cd mcp && npm test && npm run typecheck` |

DAG: T1 ∥ T2 ∥ T4 → T3 (після T1,T2); T5 ∥ T6 (після T4) → T7 → T8. MCP-задачі можна вести паралельно із server, контракт роутів зафіксовано вище.

`.mcp.json`:
```json
{ "mcpServers": { "devdigest": { "type": "stdio", "command": "node",
  "args": ["mcp/node_modules/tsx/dist/cli.mjs", "mcp/src/index.ts"],
  "env": { "DEVDIGEST_API_URL": "http://localhost:3001" } } } }
```

## Зміни поза MCP (зведення)
- server: 4 нові роути, новий `PullsService`/`pulls/repository.ts` (рефактор без зміни поведінки), методи в `RepoService`/`ReviewService`, нові it-тести.
- `server/src/vendor/shared/contracts/review-refs.ts` + barrel (у client не копіюємо).
- Корінь: `.mcp.json`, рядок у `AGENTS.md`, секція в `README.md`, план у `docs/plans/`.
- Без міграцій, без змін `client/`, `reviewer-core/`, `modules/index.ts`.

## Verification
1. `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm exec vitest run .it.test` — нові it-тести passed, НЕ skipped.
2. `cd mcp && npm test && npm run typecheck`.
3. `./scripts/dev.sh`; `curl "http://localhost:3001/repos/resolve?repo=<owner>/<name>"` → 200; UI списку PR працює як раніше.
4. `npx @modelcontextprotocol/inspector node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts` — 5 tools, annotations, без outputSchema; помилкові кейси (невідомий агент, недоданий репо, зупинений API).
5. Нова сесія Claude Code → підтвердити `.mcp.json` → `/mcp` connected → list_agents → run_agent_on_pr на реальному PR (ран видно в UI) → get_findings detailed → get_findings repo+pr → get_conventions → get_blast_radius.
6. Повторний run_agent_on_pr під час рану → reused, у UI немає дубля.
7. `/context` → MCP tools ≈ ≤2k токенів; жодного попередження 10k.

## Ризики
- Desktop-застосунок обриває stdio ~60 с vs 120 с → progress кожні 2 с; ран продовжується на server; повторний виклик підхоплює (dedup).
- Rate limit 10/хв → 429 з підказкою, без авто-retry (платно).
- API має бути запущено → помилка називає URL і команду. Рестарт API: running → failed.
- Автосинк upsert'ить усі PR репо; без GitHub-токена → «PR not found» з підказкою.
- Рефактор `pulls/routes.ts` може змінити поведінку UI → наявні тести + ручна перевірка списку PR.
- Prompt injection у rationale/snippets → виводимо як дані (fenced, обрізано).
- console.log ламає протокол → grep/тест.
- Випадковий імпорт `@devdigest/shared` у mcp (zod 3) → заборона в `mcp/AGENTS.md` + grep.

## Open questions (вирішує implementer на практиці)
- cwd stdio-сервера в Claude Code = корінь проєкту? Fallback — абсолютний шлях через `claude mcp add --scope local`.
- Точний API SDK v2 (progressToken, sendNotification, signal) — звірити з типами встановленої версії; розбіжності → `mcp/INSIGHTS.md`.
- Розширити `.claude/skills/pr-self-review/routing.md` для `mcp/**` — окремо, за бажанням.

---
---

# Додаток: кращі практики MCP (research)

## 0. Загальні принципи
- Мало інструментів, кожен — про задачу, а не 1:1 обгортка REST.
- Неймінг verb_noun + префікс; однозначні параметри (`agent_id`, `repo`, `pr`, `run_id`).
- Annotations: readOnly для читання; run — без readOnly, openWorld.
- Помилки з підказкою наступного кроку (`isError: true`).
- MCP — тонкий адаптер (onion), без бізнес-логіки.
- Безпека: валідація входу, run_id криптостійкий.
- 4 принципи (слайд): результат, а не операція; пласкі аргументи; стисла структурована відповідь; помилка веде далі.

## 1. Асинхронність
- Spec 2026-07-28: MCP stateless, Tasks винесено в extension; TS SDK v2 прибрав experimental tasks. Рекомендація spec — server-minted handles як звичайні аргументи (`run_id`).
- Claude Code: виклик > 2 хв іде у фон (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`); idle timeout stdio 30 хв, progress скидає; `MCP_TOOL_TIMEOUT` / `timeout` у `.mcp.json`; баг desktop ~60 с.
- Ідемпотентність: повтор для того ж PR+агента → наявний run_id.

## 2. Токени на старті
- Ціна = name + description + inputSchema + instructions, у кожному запиті (~250 токенів/tool у середньому).
- Короткі описи (що/коли/що повертає/залежності), пласка схема, enum + default, без outputSchema, короткі instructions, без зайвих resources/prompts, детермінований порядок.
- Tool search у Claude Code увімкнено за замовчуванням → ключові слова в назвах/описах; інші клієнти вантажать усе.
- Міряти: `/context`, `/mcp`, `count_tokens` з/без tools, MCP Inspector.
- Ліміти відповідей: warning 10k, ліміт 25k (`MAX_MCP_OUTPUT_TOKENS`), `_meta["anthropic/maxResultSizeChars"]`.

## 3. Формат відповідей
- Markdown/компактний текст (досвід Sentry; ~16% менше токенів за JSON).
- Не поєднувати structuredContent + text (Claude Code показує лише structuredContent).
- `response_format: concise|detailed` (concise ≈ 1/3 токенів), пагінація, фільтри, summary-first, людські ідентифікатори.

## 4. TypeScript SDK
- v2 стабільний (`@modelcontextprotocol/server`), v1 — maintenance. v2 вимагає zod ^4.2 (у server zod 3 → окремий пакет).
- `registerTool(name, {title, description, inputSchema: z.object, annotations}, handler(args, ctx))`; `ctx.mcpReq.signal`; StdioServerTransport; логи в stderr (MCP Logging deprecated).
- Тести: in-memory transport, Inspector, eval-сценарії.

## 5. З нотатки користувача (перевірено)
- Беремо: `.mcp.json` project scope (нова сесія після змін); `.describe()` лише на неочевидних полях; `z.coerce.number()` для pr; явні 4 annotations; залежності між tools в описі; «running» — не помилка; статуси лише вперед; `runReview` уже повертає run_id одразу (service.ts:103).
- Не беремо: «v2 SDK лише Q3 2026» (застаріло); content + structuredContent (дубль/втрата); `sendLoggingMessage` (deprecated); «tool search з 10%» (застаріло).

## Джерела
- [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [MCP spec 2025-11-25 — Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP spec 2026-07-28 — Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Claude Code docs — MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code issue #63379](https://github.com/anthropics/claude-code/issues/63379)
- [structuredContent hides content text](https://claudeissues.com/issue/55677-mcp-tool-result-content-text-dropped-from-model-when-structuredcontent-is-also-p)
- [TS SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [Upgrading to v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html)
- [Sentry MCP (ZenML)](https://www.zenml.io/llmops-database/scaling-an-mcp-server-for-error-monitoring-to-60-million-monthly-requests)
- [Cyclr — token efficiency](https://cyclr.com/resources/reports/mcp-server-design-token-efficiency) · [The New Stack — MCP token bloat](https://thenewstack.io/how-to-reduce-mcp-token-bloat/)
