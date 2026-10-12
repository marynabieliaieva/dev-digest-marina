import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/context.json";
import { ApiError } from "@/lib/api";
import type { ContextDoc } from "@/lib/types";

const docsQuery = vi.fn();
const docQuery = vi.fn();
const refreshMutate = vi.fn();

vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>not found</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/core", () => ({
  useRefreshRepo: () => ({ mutate: refreshMutate, isPending: false }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => docsQuery(),
  useContextDoc: () => docQuery(),
}));

import { ProjectContextView } from "./ProjectContextView";

function doc(path: string, est_tokens: number, used = 0): ContextDoc {
  return {
    path,
    type: "specs",
    size: 100,
    est_tokens,
    updated_at: "2026-10-10T00:00:00Z",
    used_by_agents: used,
    used_by: Array.from({ length: used }, (_, i) => ({ id: `a${i}`, name: `Agent ${i}` })),
  } as ContextDoc;
}

function result(over: Record<string, unknown>) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  docQuery.mockReturnValue(result({ data: { path: "a", content: "# Hello", size: 1, est_tokens: 1 } }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectContextView", () => {
  it("renders a skeleton while loading", () => {
    docsQuery.mockReturnValue(result({ isLoading: true }));
    renderView();
    expect(screen.getByTestId("context-skeleton")).toBeInTheDocument();
  });

  it("shows the configured globs in the empty state", () => {
    const roots = ["**/{specs,docs,insights}/**/*.md"];
    docsQuery.mockReturnValue(result({ data: { roots, docs: [] } }));
    renderView();
    expect(screen.getByText(/No context documents found/)).toBeInTheDocument();
    expect(
      screen.getByText(`No Markdown files matched the configured globs: ${roots[0]}`),
    ).toBeInTheDocument();
  });

  it("renders the footer totals", () => {
    docsQuery.mockReturnValue(
      result({ data: { roots: ["x"], docs: [doc("docs/a.md", 1000), doc("docs/b.md", 200), doc("docs/c.md", 40)] } }),
    );
    renderView();
    expect(screen.getByText("Indexed: 3 files · 1,240 tokens total")).toBeInTheDocument();
    expect(screen.getByText(/^last .+ ago$/)).toBeInTheDocument();
    expect(screen.queryByText(/chunks/i)).toBeNull();
  });

  it("shows the not-cloned state with a Sync button and no list", () => {
    docsQuery.mockReturnValue(
      result({ isError: true, error: new ApiError("nope", 409, "context_unavailable") }),
    );
    renderView();
    expect(screen.getByText("Repository not cloned yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sync/i }));
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders a heading and no edit/upload/create controls", () => {
    docsQuery.mockReturnValue(
      result({ data: { roots: ["x"], docs: [doc("docs/public-api.md", 10, 2)] } }),
    );
    renderView();
    expect(screen.getByRole("heading", { name: "public-api.md" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|upload|new folder|create/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /edit|upload|new folder|create/i })).toBeNull();
  });

  it("shows how many agents use the selected doc", () => {
    docsQuery.mockReturnValue(result({ data: { roots: ["x"], docs: [doc("docs/a.md", 10, 2)] } }));
    renderView();
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
  });

  it("calls refetch exactly once when Refresh is clicked", () => {
    const refetch = vi.fn();
    docsQuery.mockReturnValue(result({ refetch, data: { roots: ["x"], docs: [doc("docs/a.md", 10)] } }));
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
