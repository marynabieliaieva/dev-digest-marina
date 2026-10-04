import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
vi.mock("../api", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

import { usePrBlast, blastKey } from "./blast";

const response = {
  pr_id: "pr1",
  indexed_sha: null,
  index_status: "degraded",
  degraded: true,
  reason: "no_data",
  blast: { changed_symbols: [], downstream: [] },
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper };
}

describe("usePrBlast", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("fetches the blast radius for the PR", async () => {
    get.mockResolvedValue(response);
    const { wrapper } = setup();

    const query = renderHook(() => usePrBlast("pr1"), { wrapper });
    await waitFor(() => expect(query.result.current.data).toEqual(response));
    expect(get).toHaveBeenCalledWith("/pulls/pr1/blast");
    expect(blastKey("pr1")).toEqual(["pr-blast", "pr1"]);
  });

  it("does not fetch without a prId", () => {
    const { wrapper } = setup();
    renderHook(() => usePrBlast(null), { wrapper });
    renderHook(() => usePrBlast(undefined), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});
