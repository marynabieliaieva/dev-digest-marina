import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "../../../../messages/en/agents.json";
import evalMessages from "../../../../messages/en/eval.json";
import { ToastProvider } from "../../../lib/toast";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "ag1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (k: string) => (k === "tab" ? "evals" : null),
    toString: () => "tab=evals",
  }),
}));
vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../_components/AgentCard", () => ({ AgentCard: () => null }));
vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [] }),
  useAgent: () => ({
    data: {
      id: "ag1",
      name: "Sec",
      provider: "openai",
      model: "gpt-4.1",
      enabled: true,
      version: 1,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: [] }),
}));
vi.mock("../../../lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false }),
  useAgentEvalDashboard: () => ({
    data: {
      cases_total: 0,
      current: null,
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [],
      running_batch_id: null,
    },
  }),
  useEvalBatch: () => ({ data: undefined }),
  useRunAgentEvals: () => ({ mutateAsync: vi.fn() }),
  useRunEvalCase: () => ({ mutate: vi.fn() }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import AgentEditorPage from "./page";

afterEach(cleanup);

describe("Agent page ?tab=evals", () => {
  it("shows the Evals tab content", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, eval: evalMessages }}>
          <ToastProvider>
            <AgentEditorPage />
          </ToastProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Eval cases 0/0 passing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });
});
