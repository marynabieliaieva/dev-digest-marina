import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/blast.json";

const mutate = vi.fn();
const refetch = vi.fn();
let blastState: { data?: unknown; isLoading?: boolean; isError?: boolean };

vi.mock("../../../../../../../lib/hooks/blast", () => ({
  usePrBlast: () => ({ isLoading: false, isError: false, refetch, ...blastState }),
}));
vi.mock("../../../../../../../lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate, isPending: false }),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

const blast = {
  changed_symbols: [{ name: "login", file: "src/auth.ts", kind: "function" }],
  downstream: [
    {
      symbol: "login",
      callers: [{ name: "handler", file: "src/routes.ts", line: 10 }],
      endpoints_affected: ["POST /login"],
      crons_affected: [],
    },
  ],
  summary: "",
};

function respond(over: Record<string, unknown> = {}) {
  blastState = {
    data: {
      pr_id: "pr1",
      indexed_sha: "idx123",
      index_status: "full",
      degraded: false,
      reason: null,
      blast,
      ...over,
    },
  };
}

function renderCard(repoFullName: string | null = "acme/app") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusCard prId="pr1" repoId="r1" repoFullName={repoFullName} headSha="head999" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mutate.mockReset();
  refetch.mockReset();
  respond();
});
afterEach(cleanup);

describe("BlastRadiusCard", () => {
  it("links callers to the indexed sha, toggles graph and back", () => {
    renderCard();
    const link = screen.getByRole("link", { name: "src/routes.ts:10" });
    expect(link.getAttribute("href")).toBe("https://github.com/acme/app/blob/idx123/src/routes.ts#L10");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("POST /login")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.getByRole("link", { name: "src/routes.ts:10" })).toBeTruthy();
  });

  it("falls back to headSha and renders plain text without a repo", () => {
    respond({ indexed_sha: null });
    const { unmount } = renderCard();
    expect(screen.getByRole("link").getAttribute("href")).toContain("/blob/head999/");
    unmount();
    renderCard(null);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/routes.ts:10")).toBeTruthy();
  });

  it("shows the no-downstream message", () => {
    respond({ blast: { ...blast, downstream: [] } });
    renderCard();
    expect(screen.getByText("1 changed symbol(s), no downstream callers found.")).toBeTruthy();
  });

  it("shows the degraded badge and resyncs on click only", () => {
    respond({ degraded: true, reason: "index_partial", index_status: "partial" });
    renderCard();
    expect(screen.getByText(/Index is partial/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resync" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows an error with retry", () => {
    blastState = { isError: true };
    renderCard();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
