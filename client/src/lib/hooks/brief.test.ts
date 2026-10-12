import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { ApiError } from "../api";
import { useBrief, usePrBrief, __resetBriefAutoRegen } from "./brief";

const brief = { summary: "s", head_sha: "old1234" };
const staleResp = { pr_id: "p1", current_head_sha: "new5678", brief, stale: true, generating: false };
const freshResp = { ...staleResp, stale: false };

function setup(strict = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = createElement(QueryClientProvider, { client: qc }, children);
    return strict ? createElement(StrictMode, null, inner) : inner;
  };
  return { qc, wrapper };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  __resetBriefAutoRegen();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("brief hooks", () => {
  it("auto-regenerates a stale brief exactly once, even under StrictMode and re-renders", async () => {
    get.mockResolvedValue(staleResp);
    post.mockResolvedValue(freshResp);
    const { wrapper } = setup(true);

    const { result, rerender } = renderHook(() => useBrief("p1", "new5678"), { wrapper });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/pulls/p1/brief", { mode: "if_stale" });
    await waitFor(() => expect(result.current.data?.stale).toBe(false));
    rerender();
    rerender();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("does not retry after a rejected auto-regeneration", async () => {
    get.mockResolvedValue(staleResp);
    post.mockRejectedValue(new ApiError("boom", 502, "brief_generation_failed"));
    const { wrapper } = setup();

    const { result, rerender } = renderHook(() => useBrief("p1", "new5678"), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    rerender();
    rerender();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("polls after a 409 until generating is false, then holds the new brief", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValueOnce(freshResp);
    post.mockRejectedValue(new ApiError("in progress", 409, "brief_in_progress"));
    const { qc, wrapper } = setup();

    const { result } = renderHook(() => useBrief("p1", "new5678"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    // after the 409 the next GET is still generating, the one after is done
    get.mockResolvedValueOnce({ ...freshResp, generating: true });
    get.mockResolvedValue({ ...freshResp, brief: { ...brief, summary: "new" }, generating: false });
    act(() => result.current.generate("refresh"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/pulls/p1/brief", { mode: "refresh" }));
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() =>
      expect((qc.getQueryData(["pr-brief", "p1", "new5678"]) as typeof freshResp).brief).toMatchObject({
        summary: "new",
      }),
    );
    expect(result.current.pending).toBe(false);
  });

  it("does not POST when the brief is fresh", async () => {
    get.mockResolvedValue(freshResp);
    const { wrapper } = setup();
    const { result } = renderHook(() => useBrief("p1", "new5678"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(freshResp));
    expect(post).not.toHaveBeenCalled();
  });

  it("stays disabled without a headSha and refetches when it changes", async () => {
    get.mockResolvedValue(freshResp);
    const { wrapper } = setup();
    const { rerender } = renderHook(({ sha }: { sha?: string }) => usePrBrief("p1", sha), {
      wrapper,
      initialProps: { sha: undefined as string | undefined },
    });
    expect(get).not.toHaveBeenCalled();

    rerender({ sha: "aaa" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ sha: "bbb" });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
