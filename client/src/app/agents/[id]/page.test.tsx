import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

let tabParam: string | null = null;

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "ag1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({
    get: (k: string) => (k === "tab" ? tabParam : null),
    toString: () => (tabParam ? `tab=${tabParam}` : ""),
  }),
}));

vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../_components/AgentCard", () => ({ AgentCard: () => null }));
vi.mock("./_components/AgentEditor", async () => {
  const actual = await vi.importActual<typeof import("./_components/AgentEditor/constants")>(
    "./_components/AgentEditor/constants",
  );
  return {
    AgentEditor: ({ tab }: { tab: string }) => <div data-testid="active-tab">{tab}</div>,
    ...actual,
  };
});
vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [] }),
  useAgent: () => ({
    data: { id: "ag1", name: "Sec", provider: "openai", model: "gpt-4.1", enabled: true },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
}));

import AgentEditorPage from "./page";

afterEach(cleanup);

describe("Agent page tab validation", () => {
  it("passes ?tab=context through to the editor", () => {
    tabParam = "context";
    render(<AgentEditorPage />);
    expect(screen.getByTestId("active-tab")).toHaveTextContent("context");
  });

  it("falls back to config for an unknown tab", () => {
    tabParam = "bogus";
    render(<AgentEditorPage />);
    expect(screen.getByTestId("active-tab")).toHaveTextContent("config");
  });
});
