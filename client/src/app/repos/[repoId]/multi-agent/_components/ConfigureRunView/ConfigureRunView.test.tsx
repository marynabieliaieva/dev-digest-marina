import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/runs.json";

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const agent = (id: string, name: string) => ({
  id,
  name,
  description: `${name} agent`,
  enabled: true,
});
const AGENTS = [agent("a1", "Security"), agent("a2", "Perf"), agent("a3", "Style")];
const LATEST = { columns: [{ agent_id: "a1" }, { agent_id: "a2" }] };

// Network boundary: every query is already resolved on first render (cached).
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: AGENTS }) }));
vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ data: [{ number: 12, title: "Fix" }] }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useRunEstimates: () => ({ data: [] }),
  useMultiAgentRun: () => ({ data: LATEST }),
  useStartMultiAgentRun: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { ConfigureRunView } from "./ConfigureRunView";

afterEach(cleanup);

describe("ConfigureRunView", () => {
  it("pre-ticks the latest run's agents when queries are already cached on mount", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <ConfigureRunView repoId="repo-1" prNumber={12} prId="pr-1" />
      </NextIntlClientProvider>,
    );

    expect(await screen.findByRole("checkbox", { name: /Security/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Perf/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Style/ })).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Run multi-agent review (2)" }),
    ).toBeEnabled();
  });
});
