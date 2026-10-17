import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import type { EvalBatch, EvalDashboard, EvalTrendPoint } from "@devdigest/shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@devdigest/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@devdigest/ui")>();
  return {
    ...actual,
    LineChart: ({ series }: { series: { name: string; data: number[] }[] }) => (
      <div data-testid="chart" data-series={JSON.stringify(series.map((s) => [s.name, s.data.length]))} />
    ),
  };
});
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security Reviewer" }] }),
  useAgent: () => ({ data: { id: "a1", name: "Security Reviewer", model: "gpt-4.1" } }),
}));

let dashboard: EvalDashboard;
let batches: EvalBatch[];
const useEvalCompare = vi.fn((_base?: string | null, _head?: string | null) => ({
  data: undefined,
  isError: false,
  error: null,
}));
vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: () => ({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentEvalBatches: () => ({ data: batches, isLoading: false, isError: false, refetch: vi.fn() }),
  useRunAgentEvals: () => ({ mutateAsync: vi.fn() }),
  useEvalBatch: () => ({ data: undefined }),
  useEvalCompare: (b?: string | null, h?: string | null) => useEvalCompare(b, h),
}));

import { renderWithProviders, makeBatch, userEvent } from "../../../testing";
import { AgentEvalView } from "./AgentEvalView";

afterEach(() => {
  cleanup();
  useEvalCompare.mockClear();
});

const point = (v: number, day: string): EvalTrendPoint => ({
  batch_id: `b${v}`,
  agent_version: v,
  ran_at: `2026-05-${day}T09:14:00.000Z`,
  recall: 0.7 + v / 100,
  precision: 0.9,
  citation_accuracy: 0.95,
  pass_rate: 0.8,
  cost_usd: 0.2,
});

const makeDashboard = (over: Partial<EvalDashboard> = {}): EvalDashboard => ({
  owner_kind: "agent",
  owner_id: "a1",
  cases_total: 20,
  current: {
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    traces_passed: 17,
    traces_total: 20,
    cost_usd: 0.23,
  },
  delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
  trend: [point(1, "19"), point(2, "22"), point(3, "29")],
  recent_runs: [],
  recent_batches: [],
  running_batch_id: null,
  alert: "Precision dipped 2pts on v3 — a new false positive slipped in.",
  ...over,
});

describe("AgentEvalView", () => {
  it("shows tiles, chart, banner and runs; limits Compare to two done runs in base/head order", async () => {
    const user = userEvent.setup();
    dashboard = makeDashboard();
    batches = [
      makeBatch({ id: "b1", agent_version: 1, started_at: "2026-05-19T09:14:00.000Z" }),
      makeBatch({ id: "b2", agent_version: 2, started_at: "2026-05-22T09:14:00.000Z" }),
      makeBatch({ id: "b3", agent_version: 3, started_at: "2026-05-29T09:14:00.000Z" }),
      makeBatch({ id: "b4", agent_version: 4, status: "running", started_at: "2026-05-30T09:14:00.000Z" }),
      makeBatch({ id: "b5", agent_version: 5, status: "failed", started_at: "2026-05-31T09:14:00.000Z" }),
    ];
    renderWithProviders(<AgentEvalView agentId="a1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Precision dipped 2pts on v3");
    expect(screen.getByText("+4 pts")).toBeInTheDocument();
    expect(screen.getByText("−2 pts")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Recall trend, latest 73%" })).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toHaveAttribute(
      "data-series",
      JSON.stringify([["Recall", 3], ["Precision", 3], ["Citation accuracy", 3]]),
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText("v5")).toBeInTheDocument(); // newest first
    expect(within(rows[0]!).getByText("failed")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("running")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("$0.2300")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("17/20")).toBeInTheDocument();

    const compare = screen.getByRole("button", { name: "Compare" });
    expect(compare).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Select run v4/ })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /Select run v3/ }));
    expect(compare).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Select run v1/ }));
    expect(compare).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Select run v2/ })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Select run v2/ }));
    expect(screen.getByRole("checkbox", { name: /Select run v2/ })).not.toBeChecked();

    await user.click(compare);
    expect(useEvalCompare).toHaveBeenLastCalledWith("b1", "b3");
  });

  it("shows the empty state with no deltas and no banner when there are no runs", () => {
    dashboard = makeDashboard({ current: null, trend: [], alert: null });
    batches = [];
    renderWithProviders(<AgentEvalView agentId="a1" />);

    expect(screen.getByText("No eval runs yet — click Run eval")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(6);
  });

  it("renders deltas as — and no banner after a single run", () => {
    dashboard = makeDashboard({ trend: [point(1, "19")], alert: null });
    batches = [makeBatch({ id: "b1" })];
    renderWithProviders(<AgentEvalView agentId="a1" />);

    expect(screen.queryByText("+4 pts")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });
});
