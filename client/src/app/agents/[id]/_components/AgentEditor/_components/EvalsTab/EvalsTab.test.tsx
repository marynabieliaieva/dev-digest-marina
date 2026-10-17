import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseDto } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const casesQuery = vi.fn();
const dashQuery = vi.fn();
const batchQuery = vi.fn();
const deleteMutate = vi.fn();
const runCaseMutate = vi.fn();
const runAgentMutateAsync = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => casesQuery(),
  useAgentEvalDashboard: () => dashQuery(),
  useEvalBatch: (id: string | null) => batchQuery(id),
  useRunAgentEvals: () => ({ mutateAsync: runAgentMutateAsync }),
  useRunEvalCase: () => ({ mutate: runCaseMutate }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

const AGENT = { id: "a1", name: "Security Reviewer" } as Agent;

const lastResult = (over: Partial<NonNullable<EvalCaseDto["last_result"]>>) => ({
  pass: true,
  error: null,
  ran_at: "2026-10-15T10:00:00Z",
  actual_count: 1,
  matched_count: 1,
  ...over,
});

function mkCase(id: string, name: string, created: string, last: EvalCaseDto["last_result"]): EvalCaseDto {
  return {
    id,
    owner_kind: "agent",
    owner_id: "a1",
    name,
    input_diff: `diff --git a/${name} b/${name}\n+<b>raw</b>`,
    input_files: null,
    input_meta: {
      pr: { repo: "acme/payments", number: 7 },
      finding: { title: "Leaked key", rationale: "Secret in **source**" },
    },
    expected_output: null,
    source_finding_id: "f-" + id,
    created_at: created,
    expectation: {
      type: "must_find",
      file: "src/config.ts",
      start_line: 10,
      end_line: 12,
      kind: "finding",
      severity: "critical",
      category: "security",
      title: "Leaked key",
      source_finding_id: "f-" + id,
    },
    last_result: last,
  } as EvalCaseDto;
}

const FOUR = [
  mkCase("c1", "case-pass", "2026-10-15T01:00:00Z", lastResult({})),
  mkCase("c2", "case-fail", "2026-10-15T02:00:00Z", lastResult({ pass: false, matched_count: 0 })),
  mkCase("c3", "case-error", "2026-10-15T03:00:00Z", lastResult({ pass: null, error: "boom" })),
  mkCase("c4", "case-never", "2026-10-15T04:00:00Z", null),
];

const trendPoint = (batch_id: string, recall: number) => ({
  batch_id,
  agent_version: 1,
  ran_at: "2026-10-15T00:00:00Z",
  recall,
  precision: 0.9,
  citation_accuracy: 0.95,
  pass_rate: 0.5,
  cost_usd: null,
});

function dash(over: Record<string, unknown> = {}) {
  return {
    data: {
      cases_total: 4,
      current: { recall: 0.85, precision: 0.9, citation_accuracy: 0.95, traces_passed: 1, traces_total: 4, cost_usd: null },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [trendPoint("b1", 0.87), trendPoint("b2", 0.85)],
      running_batch_id: null,
      ...over,
    },
  };
}

function renderTab() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <ToastProvider>
          <EvalsTab agent={AGENT} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  casesQuery.mockReturnValue({ data: FOUR, isLoading: false });
  dashQuery.mockReturnValue(dash());
  batchQuery.mockReturnValue({ data: undefined });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EvalsTab", () => {
  it("renders every case status label and the header count, newest first", () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "Eval cases 1/4 passing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Passed")).toBeInTheDocument();
    expect(screen.getByLabelText("Failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Errored")).toBeInTheDocument();
    expect(screen.getByLabelText("Never run")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding at src/config.ts:10, got 1 matching")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    const names = screen.getAllByTitle(/^case-/).map((n) => n.textContent);
    expect(names).toEqual(["case-never", "case-error", "case-fail", "case-pass"]);
  });

  it("shows the empty text and disables Run all evals with 0 cases", () => {
    casesQuery.mockReturnValue({ data: [], isLoading: false });
    renderTab();
    expect(screen.getByText(/No eval cases yet\. Create one/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });

  it("'+ New eval case' shows the instructions", () => {
    renderTab();
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /New eval case/ }));
    expect(screen.getByRole("note")).toHaveTextContent(/Turn into eval case/);
  });

  it("view opens the panel with the frozen diff as plain text", () => {
    renderTab();
    fireEvent.click(screen.getByLabelText("View case case-pass"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^diff --git a\/case-pass/)).toBeInTheDocument();
    expect(within(dialog).getByText(/<b>raw<\/b>/)).toBeInTheDocument();
    expect(within(dialog).getByText("acme/payments#7")).toBeInTheDocument();
    expect(dialog.querySelector("b")).toBeNull();
  });

  it("confirming delete calls the delete mutation", () => {
    renderTab();
    fireEvent.click(screen.getByLabelText("Delete case case-fail"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0]![0]).toEqual({ caseId: "c2", agentId: "a1" });
  });

  it("removes the row once the cases refetch without it", () => {
    const { rerender } = renderTab();
    expect(screen.getByTitle("case-fail")).toBeInTheDocument();
    casesQuery.mockReturnValue({ data: FOUR.filter((c) => c.id !== "c2"), isLoading: false });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
          <ToastProvider>
            <EvalsTab agent={AGENT} />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByTitle("case-fail")).toBeNull();
  });

  it("tiles show values and the delta against the previous batch", () => {
    renderTab();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("−2 pts")).toBeInTheDocument();
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });

  it("resumes a running batch: the button shows Running x/y", () => {
    dashQuery.mockReturnValue(dash({ running_batch_id: "b9" }));
    batchQuery.mockImplementation((id: string | null) => ({
      data: id === "b9" ? { id: "b9", agent_id: "a1", status: "running", cases_done: 1, cases_total: 3 } : undefined,
    }));
    renderTab();
    const btn = screen.getByRole("button", { name: /Running 1\/3/ });
    expect(btn).toBeDisabled();
  });

  it("a running single-case batch is followed by its row only, not by the Run all button", () => {
    // The server reports running_batch_id only for set-scope batches, so it stays null here.
    runCaseMutate.mockImplementation((_id: string, opts: { onSuccess: (r: { batch_id: string }) => void }) =>
      opts.onSuccess({ batch_id: "r1" }),
    );
    batchQuery.mockImplementation((id: string | null) => ({
      data: id === "r1" ? { id: "r1", agent_id: "a1", status: "running", cases_done: 0, cases_total: 1 } : undefined,
    }));
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Run case case-pass/ }));
    expect(screen.queryByRole("button", { name: /Running/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run all evals/ })).toBeEnabled();
  });

  it("a 409 for a running case batch is followed by the row", () => {
    runCaseMutate.mockImplementation((_id: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new ApiError("running", 409, "batch_running", { batch_id: "r7", scope: "case" })),
    );
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Run case case-pass/ }));
    expect(batchQuery).toHaveBeenCalledWith("r7");
  });

  it("a 409 for a running set batch shows an info toast and follows nothing", () => {
    runCaseMutate.mockImplementation((_id: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new ApiError("running", 409, "batch_running", { batch_id: "s1", scope: "set" })),
    );
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Run case case-pass/ }));
    expect(screen.getByText("An eval run is already in progress for this agent")).toBeInTheDocument();
    expect(batchQuery).not.toHaveBeenCalledWith("s1");
  });

  it("clears the row batch when it 404s so the other rows can run again", () => {
    runCaseMutate.mockImplementation((_id: string, opts: { onSuccess: (r: { batch_id: string }) => void }) =>
      opts.onSuccess({ batch_id: "r1" }),
    );
    batchQuery.mockImplementation((id: string | null) => ({
      data: undefined,
      error: id === "r1" ? new ApiError("gone", 404) : null,
    }));
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Run case case-pass/ }));
    fireEvent.click(screen.getByRole("button", { name: /Run case case-fail/ }));
    expect(runCaseMutate).toHaveBeenCalledTimes(2);
  });
});
