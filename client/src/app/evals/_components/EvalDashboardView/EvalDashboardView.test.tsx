import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, within, waitFor } from "@testing-library/react";
import type { AgentEvalSummary, EvalBatch } from "@devdigest/shared";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let dashboardData: { agents: AgentEvalSummary[]; recent_batches: EvalBatch[] } | undefined;
const mutateAsync = vi.fn();
let batchResult: { data: undefined; isError: boolean } = { data: undefined, isError: false };
vi.mock("@/lib/hooks/evals", () => ({
  useEvalWorkspaceDashboard: () => ({
    data: dashboardData,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRunAllEvals: () => ({ mutateAsync, isPending: false }),
  useEvalBatch: () => batchResult,
}));

import { renderWithProviders, makeBatch, userEvent } from "../../testing";
import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  push.mockReset();
  mutateAsync.mockReset();
  batchResult = { data: undefined, isError: false };
});

const agent = (over: Partial<AgentEvalSummary>): AgentEvalSummary => ({
  agent_id: "a1",
  agent_name: "Security Reviewer",
  model: "gpt-4.1",
  enabled: true,
  cases_total: 20,
  last_batch: null,
  sparkline: [],
  running_batch_id: null,
  ...over,
});

describe("EvalDashboardView", () => {
  it("renders the three row states, navigates on click and runs all agents", async () => {
    const user = userEvent.setup();
    dashboardData = {
      agents: [
        agent({ last_batch: makeBatch({ agent_version: 7 }), sparkline: [0.7, 0.8, 0.82] }),
        agent({ agent_id: "a2", agent_name: "Perf Reviewer", cases_total: 4 }),
        agent({ agent_id: "a3", agent_name: "Empty Agent", cases_total: 0 }),
      ],
      recent_batches: [],
    };
    mutateAsync.mockResolvedValue({
      started: [{ agent_id: "a1", batch_id: "b9" }],
      skipped: [
        { agent_id: "a2", reason: "running" },
        { agent_id: "a3", reason: "no_cases" },
      ],
    });
    renderWithProviders(<EvalDashboardView />);

    expect(screen.getByText("Last run v7 · 2026-05-29 09:14 · 17/20 pass")).toBeInTheDocument();
    expect(screen.getByText("Never run")).toBeInTheDocument();
    expect(screen.getByText("No eval cases")).toBeInTheDocument();
    // Row with a done batch shows its metrics; rows without one show "—" for all three.
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(6);

    await user.click(screen.getByRole("button", { name: /Perf Reviewer/ }));
    expect(push).toHaveBeenCalledWith("/evals/a2");

    await user.click(screen.getByRole("button", { name: "Run all agents" }));
    expect(await screen.findByText("Started 1 runs, skipped 2")).toBeInTheDocument();
  });

  it("stops watching a batch whose query errors so Run all agents re-enables", async () => {
    const user = userEvent.setup();
    dashboardData = { agents: [agent({})], recent_batches: [] };
    batchResult = { data: undefined, isError: true };
    mutateAsync.mockResolvedValue({ started: [{ agent_id: "a1", batch_id: "b9" }], skipped: [] });
    renderWithProviders(<EvalDashboardView />);

    await user.click(screen.getByRole("button", { name: "Run all agents" }));
    await screen.findByText("Started 1 runs, skipped 0");
    await waitFor(() => expect(screen.getByRole("button", { name: "Run all agents" })).toBeEnabled());
  });

  it("lists at most 20 recent runs, newest first", () => {
    dashboardData = {
      agents: [],
      recent_batches: Array.from({ length: 25 }, (_, i) =>
        makeBatch({
          id: `b${i}`,
          agent_name: `Agent ${String(i).padStart(2, "0")}`,
          started_at: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
        }),
      ),
    };
    renderWithProviders(<EvalDashboardView />);

    const items = within(screen.getByRole("list", { name: "Recent eval runs · all agents" })).getAllByRole("listitem");
    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent("Agent 24");
    expect(items[19]).toHaveTextContent("Agent 05");
  });
});
