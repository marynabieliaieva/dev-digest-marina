/* Test-only helpers for the /evals route tests (providers + fixtures). */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatch } from "@devdigest/shared";
import { ToastProvider } from "@/lib/toast";
import messages from "../../../messages/en/eval.json";

export function renderWithProviders(ui: React.ReactElement): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/* Minimal stand-in for @testing-library/user-event (not installed in this
   package): click focuses the element first, like a real pointer press. */
const user = {
  click: async (el: Element) => {
    await act(async () => {
      (el as HTMLElement).focus?.();
      fireEvent.click(el);
    });
  },
  keyboard: async (keys: string) => {
    const key = keys.replace(/[{}]/g, "");
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key });
    });
  },
};
export const userEvent = { setup: () => user };

export function makeBatch(over: Partial<EvalBatch> = {}): EvalBatch {
  return {
    id: "b1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    scope: "set",
    agent_version: 1,
    status: "done",
    error: null,
    started_at: "2026-05-29T09:14:00.000Z",
    finished_at: "2026-05-29T09:15:00.000Z",
    cases_total: 20,
    cases_done: 20,
    traces_passed: 17,
    traces_total: 20,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cost_usd: 0.23,
    duration_ms: 60000,
    ...over,
  };
}
