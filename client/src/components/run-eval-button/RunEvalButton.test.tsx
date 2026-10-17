import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/eval.json";

const get = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { get: (...a: unknown[]) => get(...a) } };
});

import { ApiError } from "@/lib/api";
import { ToastProvider } from "@/lib/toast";
import { RunEvalButton } from "./RunEvalButton";

const batch = (over: Record<string, unknown>) => ({
  id: "b1",
  agent_id: "a1",
  status: "running",
  cases_done: 1,
  cases_total: 3,
  traces_passed: null,
  traces_total: null,
  error: null,
  ...over,
});

function renderButton(props: Partial<React.ComponentProps<typeof RunEvalButton>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onStart = vi.fn().mockResolvedValue({ batch_id: "b1" });
  const onFinished = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <ToastProvider>
          <RunEvalButton label="Run eval" onStart={onStart} onFinished={onFinished} {...props} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onStart, onFinished, qc };
}

const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  get.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("RunEvalButton", () => {
  it("shows Running x/y disabled while polling, then toasts the result and re-enables", async () => {
    get
      .mockResolvedValueOnce(batch({}))
      .mockResolvedValue(batch({ status: "done", cases_done: 3, traces_passed: 2, traces_total: 3 }));
    const { onFinished } = renderButton();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run eval" }));
    });
    await tick(0);

    const running = screen.getByRole("button", { name: /Running 1\/3/ });
    expect(running).toBeDisabled();

    await tick(2000);
    await tick(1);
    expect(screen.getByText("Eval run finished — 2/3 passed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run eval" })).toBeEnabled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("resumes polling a batch that was already running", async () => {
    get.mockResolvedValue(batch({ cases_done: 2 }));
    const { onStart } = renderButton({ runningBatchId: "b1" });

    await tick(0);
    expect(screen.getByRole("button", { name: /Running 2\/3/ })).toBeDisabled();
    expect(onStart).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith("/eval-runs/b1");
  });

  it("toasts the error when the batch failed", async () => {
    get.mockResolvedValue(batch({ status: "failed", error: "no API key" }));
    renderButton({ runningBatchId: "b1" });

    await tick(0);
    await tick(1);
    expect(screen.getByText("Eval run failed: no API key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run eval" })).toBeEnabled();
  });

  it("keeps running when the first batch fetch fails, and stops on a 404", async () => {
    get
      .mockRejectedValueOnce(new ApiError("boom", 500))
      .mockRejectedValue(new ApiError("gone", 404));
    renderButton({ runningBatchId: "b1" });

    await tick(0);
    expect(screen.getByRole("button", { name: /Running 0\/0/ })).toBeDisabled();

    await tick(2000);
    await tick(1);
    expect(screen.getByRole("button", { name: "Run eval" })).toBeEnabled();
  });

  it("follows the running batch from a 409 batch_running conflict", async () => {
    get.mockResolvedValue(batch({ id: "b9", cases_done: 0 }));
    const onStart = vi
      .fn()
      .mockRejectedValue(new ApiError("running", 409, "batch_running", { batch_id: "b9", scope: "set" }));
    renderButton({ onStart });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run eval" }));
    });
    await tick(0);

    expect(get).toHaveBeenCalledWith("/eval-runs/b9");
    expect(screen.getByRole("button", { name: /Running 0\/3/ })).toBeDisabled();
  });

  it("does not follow a single-case batch from a 409; shows an info toast instead", async () => {
    const onStart = vi
      .fn()
      .mockRejectedValue(new ApiError("running", 409, "batch_running", { batch_id: "c1", scope: "case" }));
    renderButton({ onStart });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run eval" }));
    });
    await tick(0);

    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText("An eval run is already in progress for this agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run eval" })).toBeEnabled();
  });
});
