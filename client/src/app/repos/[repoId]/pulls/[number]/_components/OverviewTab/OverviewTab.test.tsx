import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import intentMessages from "../../../../../../../../messages/en/intent.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

// Network boundary: the brief hooks run for real on top of this mocked api.
const apiGet = vi.fn();
vi.mock("../../../../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../../lib/api")>();
  return { ...actual, api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() } };
});

// Sibling cards are not under test; stub their network hooks.
vi.mock("../../../../../../../lib/hooks/intent", () => ({
  usePrIntent: () => ({ data: undefined }),
  useDeriveIntent: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock("../../../../../../../lib/hooks/blast", () => ({
  usePrBlast: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
}));
vi.mock("../../../../../../../lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: vi.fn(), isPending: false }),
}));

import type { ReviewRecord } from "@devdigest/shared";
import { OverviewTab } from "./OverviewTab";

const briefResponse = {
  pr_id: "p1",
  current_head_sha: "abcdef1234567",
  stale: false,
  generating: false,
  brief: {
    summary: "Adds login throttling",
    head_sha: "abcdef1234567",
    model: "gpt-x",
    cost_usd: null,
    data_gaps: [],
    risks: { risks: [] },
    review_focus: [{ file: "src/config.ts", line: 12, reason: "live key committed" }],
  },
};

function finding(over: Record<string, unknown>) {
  return { id: "f", review_id: "r", severity: "CRITICAL", accepted_at: null, dismissed_at: null, ...over };
}

function review(over: Partial<ReviewRecord> & Record<string, unknown>): ReviewRecord {
  return {
    id: "r1",
    pr_id: "p1",
    agent_id: null,
    run_id: null,
    agent_name: null,
    kind: "review",
    verdict: "request_changes",
    summary: "Looks risky",
    score: 40,
    model: null,
    created_at: "2026-10-10T00:00:00Z",
    findings: [],
    ...over,
  } as ReviewRecord;
}

type MqlListener = (e: { matches: boolean }) => void;
let listeners: MqlListener[] = [];

function mockMatchMedia(matches: boolean) {
  listeners = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: (_: string, cb: MqlListener) => listeners.push(cb),
    removeEventListener: (_: string, cb: MqlListener) => {
      listeners = listeners.filter((l) => l !== cb);
    },
  })) as unknown as typeof window.matchMedia;
}

const onNavigate = vi.fn();

function renderTab(over: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ brief: briefMessages, intent: intentMessages, blast: blastMessages, prReview: prReviewMessages }}
      >
        <OverviewTab
          prId="p1"
          repoId="r1"
          repoFullName="o/r"
          headSha="abcdef1234567"
          prBody="The description"
          prNumber={482}
          reviews={[review({})]}
          changedFiles={["src/config.ts"]}
          onNavigate={onNavigate}
          {...over}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue(briefResponse);
  onNavigate.mockReset();
  mockMatchMedia(false);
});
afterEach(cleanup);

describe("OverviewTab", () => {
  it("orders banner, brief, intent/blast, description and deep-links a focus item", async () => {
    renderTab();
    const focus = await screen.findByRole("button", { name: /src\/config\.ts:12/ });

    const banner = screen.getByText("PR SCORE");
    const briefTitle = screen.getByText("PR brief");
    const intentTitle = screen.getByText("Intent");
    const description = screen.getByText("The description");
    const before = (a: Node, b: Node) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(before(banner, briefTitle)).toBeTruthy();
    expect(before(briefTitle, intentTitle)).toBeTruthy();
    expect(before(intentTitle, description)).toBeTruthy();

    fireEvent.click(focus);
    expect(onNavigate).toHaveBeenCalledWith("/repos/r1/pulls/482?tab=diff&file=src%2Fconfig.ts&line=12");
  });

  it("switches the Intent/Blast layout with the media query", async () => {
    mockMatchMedia(true);
    renderTab();
    const wrapper = () => screen.getByText("Intent").closest("[data-layout]")!;
    await screen.findByText("Adds login throttling");
    expect(wrapper().getAttribute("data-layout")).toBe("two-col");

    cleanup();
    mockMatchMedia(false);
    renderTab();
    await screen.findByText("Adds login throttling");
    expect(wrapper().getAttribute("data-layout")).toBe("stacked");

    act(() => listeners.forEach((l) => l({ matches: true })));
    expect(wrapper().getAttribute("data-layout")).toBe("two-col");
  });

  it("shows the latest verdict with non-dismissed CRITICAL blockers, or no banner", async () => {
    renderTab({
      reviews: [
        review({
          id: "new",
          score: 80,
          findings: [
            finding({ id: "a" }),
            finding({ id: "b", dismissed_at: "2026-10-10T00:00:00Z" }),
            finding({ id: "c", severity: "LOW" }),
          ] as ReviewRecord["findings"],
        }),
        review({ id: "old", score: 40 }),
      ],
    });
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.queryByText("40")).toBeNull();
    expect(screen.getByText(/3 findings · 1 blockers/)).toBeTruthy();
    await screen.findByText("Adds login throttling");

    cleanup();
    renderTab({ reviews: [review({ kind: "summary", verdict: null }), review({ verdict: null })] });
    expect(screen.queryByText("PR SCORE")).toBeNull();
    await screen.findByText("Adds login throttling");
  });

  it("does not request the brief until the head SHA is known", async () => {
    renderTab({ headSha: undefined });
    await screen.findByText("The description");
    expect(apiGet).not.toHaveBeenCalled();
  });
});
