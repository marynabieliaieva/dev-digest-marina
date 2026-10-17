import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

vi.mock("./_components/CiTab", () => ({ CiTab: () => <div>CI-TAB-CONTENT</div> }));

import { AgentEditor } from "./AgentEditor";
import { VALID_TABS } from "./constants";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders tabs Config · Skills · Context · Evals in order", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    const tabLabels = labels.filter((l) => ["Config", "Skills", "Context", "Evals"].includes(l ?? ""));
    expect(tabLabels).toEqual(["Config", "Skills", "Context", "Evals"]);
  });

  it("renders ONLY the CI tab content on tab=ci (not the Config form underneath)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="ci" onTab={() => {}} />);
    expect(screen.getByText("CI-TAB-CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
    expect(screen.queryByText("Save agent")).not.toBeInTheDocument();
  });

  it("accepts evals as a valid ?tab= value", () => {
    expect(VALID_TABS).toContain("evals");
  });
});
