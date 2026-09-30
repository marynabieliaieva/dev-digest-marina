import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

import { usePrIntent, useDeriveIntent } from "./intent";

const response = { pr_id: "p1", current_head_sha: "abc1234", intent: null };

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe("intent hooks", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("fetches the intent and re-derives into the cache", async () => {
    get.mockResolvedValue(response);
    post.mockResolvedValue({ ...response, current_head_sha: "def5678" });
    const { qc, wrapper } = setup();

    const query = renderHook(() => usePrIntent("p1"), { wrapper });
    await waitFor(() => expect(query.result.current.data).toEqual(response));
    expect(get).toHaveBeenCalledWith("/pulls/p1/intent");

    const mutation = renderHook(() => useDeriveIntent("p1"), { wrapper });
    mutation.result.current.mutate();
    await waitFor(() => expect(post).toHaveBeenCalledWith("/pulls/p1/intent/derive"));
    await waitFor(() =>
      expect(qc.getQueryData(["pr-intent", "p1"])).toEqual({ ...response, current_head_sha: "def5678" }),
    );
  });

  it("does not fetch without a prId", () => {
    const { wrapper } = setup();
    renderHook(() => usePrIntent(undefined), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});
