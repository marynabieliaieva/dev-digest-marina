import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/runs.json";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments" } }),
}));
// The trace drawer has its own tests; here we only care that it opens for the right run.
vi.mock("@/components/run-trace-drawer", () => ({
  default: ({ runId }: { runId: string }) => <div role="dialog">trace of {runId}</div>,
}));

import { MultiAgentResultsView } from "./MultiAgentResultsView";

const PR_ID = "pr-1";
const RUN_URL = `/pulls/${PR_ID}/multi-agent`;

const col = (over: Partial<AgentColumn>): AgentColumn => ({
  run_id: "r1",
  agent_id: "a1",
  agent_name: "Security",
  provider: "openai",
  model: "gpt-4.1",
  status: "running",
  error: null,
  verdict: null,
  score: null,
  summary: null,
  duration_ms: null,
  cost_usd: null,
  tokens_in: null,
  tokens_out: null,
  findings_count: null,
  findings: [],
  ...over,
});

const FINDING = {
  id: "f1",
  severity: "CRITICAL" as const,
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  kind: "finding",
};

const doneSec = col({
  status: "done",
  score: 65,
  duration_ms: 8200,
  cost_usd: 0.06,
  findings_count: 1,
  findings: [FINDING],
});
const runningPerf = col({ run_id: "r2", agent_id: "a2", agent_name: "Perf" });

const makeRun = (columns: AgentColumn[], over: Partial<MultiAgentRun> = {}): MultiAgentRun => ({
  id: "m1",
  pr_id: PR_ID,
  pr_number: 12,
  ran_at: "2026-10-01T00:00:00Z",
  status: columns.some((c) => c.status === "running") ? "running" : "done",
  agent_count: columns.length,
  total_duration_ms: 8200,
  total_cost_usd: 0.06,
  total_tokens_in: null,
  total_tokens_out: null,
  columns,
  conflicts: [],
  ...over,
});

/** What the mocked network answers for the multi-agent endpoint. */
let multiResponse: { status: number; body: unknown };
let multiCalls = 0;

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, statusText: "", json: async () => body } as Response;
}

beforeEach(() => {
  multiCalls = 0;
  router.push.mockClear();
  router.replace.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith(RUN_URL)) {
        multiCalls++;
        return jsonResponse(multiResponse.status, multiResponse.body);
      }
      if (url.endsWith("/repos/repo1/pulls")) {
        return jsonResponse(200, [{ id: PR_ID, number: 12, title: "Add rate limiting", head_sha: "abc" }]);
      }
      if (url.endsWith(`/pulls/${PR_ID}/reviews`)) return jsonResponse(200, []);
      return jsonResponse(404, { error: { code: "not_found", message: "nope" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <MultiAgentResultsView repoId="repo1" prNumber={12} prId={PR_ID} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Advance fake time and let pending promises (fetch, react-query notifications) settle. */
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("MultiAgentResultsView", () => {
  it("shows the header, a failed column's error + trace drawer, and an openable disagreement take", async () => {
    const failed = col({ run_id: "r2", agent_id: "a2", agent_name: "Perf", status: "failed", error: "Quota exceeded" });
    multiResponse = {
      status: 200,
      body: makeRun([doneSec, failed], {
        conflicts: [
          {
            file: "src/config.ts",
            line: 11,
            end_line: 11,
            title: "Hardcoded secret",
            is_conflict: true,
            takes: [
              { run_id: "r1", agent_id: "a1", persona: "Security", verdict: "CRITICAL", note: "Hardcoded secret", finding_ids: ["f1"] },
              { run_id: "r2", agent_id: "a2", persona: "Perf", verdict: "failed", note: "Run failed", finding_ids: [] },
            ],
          },
        ],
      }),
    };
    vi.useFakeTimers();
    renderView();
    await tick(0);

    expect(screen.getByRole("heading", { name: "Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByText("2 agents · parallel · 8.2s total · $0.06")).toBeInTheDocument();
    expect(screen.getByText(/Add rate limiting/)).toBeInTheDocument();

    const perf = screen.getByRole("region", { name: "Perf" });
    expect(within(perf).getByText("Quota exceeded")).toBeInTheDocument();
    fireEvent.click(within(perf).getByRole("button", { name: "View trace" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("trace of r2");

    // Clicking the flagged take jumps to Tabs mode on that agent's finding.
    const take = within(screen.getByRole("region", { name: "Where agents disagree" })).getByRole("button", {
      name: /Security/,
    });
    fireEvent.click(take);
    const url = router.replace.mock.calls[0]![0] as string;
    expect(url).toContain("view=tabs");
    expect(url).toContain("run=r1");
    expect(url).toContain("finding=f1");
  });

  it("shows the empty state with a configure CTA when no run exists (404)", async () => {
    multiResponse = { status: 404, body: { error: { code: "no_multi_agent_run", message: "none" } } };
    vi.useFakeTimers();
    renderView();
    await tick(0);

    expect(screen.getByText("No multi-agent run yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure a run" }));
    expect(router.push).toHaveBeenCalledWith("/repos/repo1/multi-agent?configure=1&pr=12");
  });

  it("polls while running, updates a column when it finishes, and stops once all are done", async () => {
    multiResponse = { status: 200, body: makeRun([col({}), runningPerf]) };
    vi.useFakeTimers();
    renderView();
    await tick(0);

    expect(multiCalls).toBe(1);
    // Disagreement block shows only the waiting note while anything runs.
    expect(screen.getByText("The comparison appears when all agents finish.")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Security" })).getByText("Running…")).toBeInTheDocument();

    await tick(4000);
    expect(multiCalls).toBe(3); // ~2 polls per 4s

    // Security finishes, Perf is still running.
    multiResponse = { status: 200, body: makeRun([doneSec, runningPerf]) };
    await tick(2500);
    const sec = screen.getByRole("region", { name: "Security" });
    expect(within(sec).getByText("Done")).toBeInTheDocument();
    expect(within(sec).getByText("Hardcoded secret")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Perf" })).getByText("Running…")).toBeInTheDocument();

    // Everything done: polling stops.
    multiResponse = { status: 200, body: makeRun([doneSec, { ...runningPerf, status: "done" }]) };
    await tick(2500);
    const settled = multiCalls;
    await tick(10000);
    expect(multiCalls).toBe(settled);
    expect(screen.queryByText("The comparison appears when all agents finish.")).not.toBeInTheDocument();
  });

  it("hides the disagreement block for a single column", async () => {
    multiResponse = { status: 200, body: makeRun([doneSec]) };
    vi.useFakeTimers();
    renderView();
    await tick(0);

    expect(screen.getByRole("region", { name: "Security" })).toBeInTheDocument();
    expect(screen.queryByText("Where agents disagree")).not.toBeInTheDocument();
  });
});
