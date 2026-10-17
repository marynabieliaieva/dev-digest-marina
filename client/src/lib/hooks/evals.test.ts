import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      del: (...a: unknown[]) => del(...a),
    },
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { ApiError } from "../api";
import { Providers } from "../providers";
import { useEvalBatch, useCreateEvalCase, useDeleteEvalCase } from "./evals";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

const batch = (status: "running" | "done", cases_done: number) => ({
  id: "b1",
  status,
  cases_done,
  cases_total: 3,
});

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useEvalBatch", () => {
  it("refetches every 2 s while running and stops once done", async () => {
    vi.useFakeTimers();
    get
      .mockResolvedValueOnce(batch("running", 0))
      .mockResolvedValueOnce(batch("running", 1))
      .mockResolvedValue(batch("done", 3));
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalBatch("b1"), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.data?.status).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(get).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(get).toHaveBeenCalledTimes(3);
    expect(result.current.data?.status).toBe("done");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("keeps polling after a failed first fetch (no data yet)", async () => {
    vi.useFakeTimers();
    get
      .mockRejectedValueOnce(new ApiError("boom", 500))
      .mockResolvedValue(batch("running", 1));
    const { wrapper } = setup();
    const { result } = renderHook(() => useEvalBatch("b1"), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.data?.status).toBe("running");
  });

  it("does not fetch without a batch id", () => {
    const { wrapper } = setup();
    renderHook(() => useEvalBatch(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useCreateEvalCase", () => {
  it("sets eval_case_id on the cached finding", async () => {
    post.mockResolvedValue({ id: "case-1" });
    const { qc, wrapper } = setup();
    qc.setQueryData(["reviews", "pr1"], [
      { id: "r1", findings: [{ id: "f1", eval_case_id: null }, { id: "f2", eval_case_id: null }] },
    ]);
    const { result } = renderHook(() => useCreateEvalCase(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", prId: "pr1", agentId: "a1" });
    });

    expect(post).toHaveBeenCalledWith("/findings/f1/eval-case");
    const cached = qc.getQueryData<{ findings: { id: string; eval_case_id: string | null }[] }[]>([
      "reviews",
      "pr1",
    ]);
    expect(cached?.[0]?.findings).toEqual([
      { id: "f1", eval_case_id: "case-1" },
      { id: "f2", eval_case_id: null },
    ]);
  });

  it("invalidates the reviews cache on a 409 already_eval_case", async () => {
    post.mockRejectedValue(new ApiError("dup", 409, "already_eval_case"));
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateEvalCase(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", prId: "pr1", agentId: "a1" }).catch(() => {});
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: ["reviews", "pr1"] });
  });

  it("does not invalidate reviews on other errors", async () => {
    post.mockRejectedValue(new ApiError("boom", 500, "x"));
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateEvalCase(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", prId: "pr1", agentId: "a1" }).catch(() => {});
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useDeleteEvalCase", () => {
  it("invalidates the reviews queries so findings drop eval_case_id", async () => {
    del.mockResolvedValue(undefined);
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteEvalCase(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ caseId: "c1", agentId: "a1" });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["reviews"] });
  });
});

describe("global mutation toast", () => {
  function Probe() {
    const evalCase = useCreateEvalCase();
    const other = useMutation({
      mutationFn: async () => {
        throw new ApiError("other failed", 500);
      },
    });
    return createElement(
      "div",
      null,
      createElement("button", { onClick: () => evalCase.mutate({ findingId: "f1", prId: "p" }) }, "eval"),
      createElement("button", { onClick: () => other.mutate() }, "other"),
    );
  }

  it("skips the toast for the eval-case mutation but not for others", async () => {
    get.mockResolvedValue([]);
    post.mockRejectedValue(new ApiError("already an eval case", 409, "already_eval_case"));
    render(createElement(Providers, null, createElement(Probe)));

    await act(async () => {
      fireEvent.click(screen.getByText("eval"));
    });
    expect(screen.queryByText("already an eval case")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("other"));
    });
    expect(await screen.findByText("other failed")).toBeInTheDocument();
  });
});
