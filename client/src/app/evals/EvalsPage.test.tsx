import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { Crumb } from "@devdigest/ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ crumb, children }: { crumb?: Crumb[]; children: React.ReactNode }) => (
    <div>
      <nav aria-label="breadcrumb">{crumb?.map((c) => <span key={c.label}>{c.label}</span>)}</nav>
      {children}
    </div>
  ),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalWorkspaceDashboard: () => ({
    data: {
      agents: [
        {
          agent_id: "a1",
          agent_name: "Security Reviewer",
          model: "gpt-4.1",
          enabled: true,
          cases_total: 3,
          last_batch: null,
          sparkline: [],
          running_batch_id: null,
        },
      ],
      recent_batches: [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRunAllEvals: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEvalBatch: () => ({ data: undefined }),
}));

import { renderWithProviders } from "./testing";
import EvalsPage from "./page";

afterEach(cleanup);

describe("/evals page", () => {
  it("renders the breadcrumb and the agent rows", () => {
    renderWithProviders(<EvalsPage />);

    const crumb = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(crumb).toHaveTextContent("Skills Lab");
    expect(crumb).toHaveTextContent("Eval Dashboard");
    expect(screen.getByRole("button", { name: /Security Reviewer/ })).toBeInTheDocument();
  });
});
