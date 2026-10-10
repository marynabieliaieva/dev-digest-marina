import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import pickerMessages from "../../../../../../../../messages/en/contextPicker.json";
import { ApiError } from "@/lib/api";
import type { Agent } from "@devdigest/shared";

const docsQuery = vi.fn();
const contextQuery = vi.fn();
const mutate = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { full_name: "acme/payments-api" } }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => docsQuery(),
  useAgentContext: () => contextQuery(),
  useSetAgentContext: () => ({ mutate }),
  useContextDoc: () => ({ data: undefined, isLoading: true, isError: false }),
}));

import { ContextTab } from "./ContextTab";

const doc = (path: string) => ({
  path,
  type: "specs",
  size: 100,
  est_tokens: 10,
  updated_at: "2026-10-10T00:00:00Z",
  used_by_agents: 0,
  used_by: [],
});

function render_() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, contextPicker: pickerMessages }}>
      <ContextTab agent={{ id: "a1" } as Agent} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContextTab", () => {
  it("renders both static AC-19 sentences", () => {
    docsQuery.mockReturnValue({ data: { roots: [], docs: [doc("specs/a.md")] }, isLoading: false, isError: false });
    contextQuery.mockReturnValue({ data: { paths: [], inherited: [] }, isLoading: false, isError: false });
    render_();
    expect(screen.getByText(/Injected as an untrusted block/)).toBeTruthy();
    expect(screen.getByText(/Order matters — earlier docs appear earlier/)).toBeTruthy();
  });

  it("shows an inherited row as 'via <skill>' with a read-only checkbox", () => {
    docsQuery.mockReturnValue({ data: { roots: [], docs: [doc("specs/a.md")] }, isLoading: false, isError: false });
    contextQuery.mockReturnValue({
      data: { paths: [], inherited: [{ path: "specs/a.md", skill_id: "s1", skill_name: "Security" }] },
      isLoading: false,
      isError: false,
    });
    render_();
    expect(screen.getByText("via Security")).toBeTruthy();
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.closest("[aria-disabled='true']")).not.toBeNull();
    fireEvent.click(box);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("checking a row saves previous paths plus the new one", () => {
    docsQuery.mockReturnValue({
      data: { roots: [], docs: [doc("specs/a.md"), doc("specs/b.md")] },
      isLoading: false,
      isError: false,
    });
    contextQuery.mockReturnValue({ data: { paths: ["specs/a.md"], inherited: [] }, isLoading: false, isError: false });
    render_();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(mutate).toHaveBeenCalledWith({ paths: ["specs/a.md", "specs/b.md"] });
  });

  it("shows an inline note and missing attached rows when the repo is not cloned", () => {
    docsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError("x", 409, "context_unavailable"),
    });
    contextQuery.mockReturnValue({ data: { paths: ["specs/a.md"], inherited: [] }, isLoading: false, isError: false });
    render_();
    expect(screen.getByText(/Repository not cloned yet/)).toBeTruthy();
    expect(screen.getByText("missing in acme/payments-api")).toBeTruthy();
  });
});
