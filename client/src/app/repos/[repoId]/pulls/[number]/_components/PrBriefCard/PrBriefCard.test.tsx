import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/brief.json";

const generate = vi.fn();
const retry = vi.fn();
let hookState: {
  data: unknown;
  isLoading?: boolean;
  pending?: boolean;
  error?: Error | null;
};

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  useBrief: () => ({
    data: hookState.data,
    isLoading: hookState.isLoading ?? false,
    pending: hookState.pending ?? false,
    error: hookState.error ?? null,
    generate,
    retry,
  }),
}));

import { PrBriefCard } from "./PrBriefCard";
import { buildDiffHref } from "./helpers";

const baseBrief = {
  summary: "Adds login throttling",
  head_sha: "abcdef1234567",
  model: "gpt-x",
  cost_usd: 0.0123,
  data_gaps: [] as unknown[],
  risks: {
    risks: [
      {
        kind: "secret",
        title: "Key committed",
        explanation: "A live key is in the config",
        severity: "high",
        file_refs: ["src/config.ts", "docs/blast-only.md"],
      },
    ],
  },
  review_focus: [
    { file: "src/config.ts", line: 12, reason: "live key committed" },
    { file: "src/other.ts", line: 3, reason: "blast only" },
  ],
};

function setBrief(over: Record<string, unknown> = {}, flags: { pending?: boolean; error?: Error } = {}) {
  hookState = {
    data: {
      pr_id: "p1",
      current_head_sha: "abcdef1234567",
      stale: false,
      generating: false,
      brief: { ...baseBrief, ...over },
    },
    ...flags,
  };
}

const onNavigate = vi.fn();

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <PrBriefCard
        prId="p1"
        headSha="abcdef1234567"
        repoId="r1"
        number={482}
        changedFiles={["src/config.ts"]}
        onNavigate={onNavigate}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  generate.mockReset();
  retry.mockReset();
  onNavigate.mockReset();
  setBrief();
});
afterEach(cleanup);

describe("PrBriefCard", () => {
  it("renders summary, sha7, model and cost; refresh sends mode refresh", () => {
    renderCard();
    expect(screen.getByText(baseBrief.summary)).toBeTruthy();
    expect(screen.getByText(/Generated for abcdef1 · gpt-x/)).toBeTruthy();
    expect(screen.getByText(/Cost \$0\.0123/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh brief" }));
    expect(generate).toHaveBeenCalledWith("refresh");
  });

  it("omits the cost when it is null", () => {
    setBrief({ cost_usd: null });
    renderCard();
    expect(screen.queryByText(/Cost/)).toBeNull();
  });

  it("renders one phrase per data gap and omits the note when empty", () => {
    renderCard();
    expect(screen.queryByRole("region", { name: "Some inputs were unavailable" })).toBeNull();
    cleanup();
    setBrief({ data_gaps: [{ source: "linked_issue", status: "missing", reason: "no link" }] });
    renderCard();
    const region = screen.getByRole("region", { name: "Some inputs were unavailable" });
    expect(within(region).getByText("Linked issue (missing): no link")).toBeTruthy();
  });

  it("shows risk severity, toggles the explanation, and says when there are none", () => {
    renderCard();
    const icon = screen.getByRole("img", { name: /high/ });
    expect(icon.getAttribute("style") ?? "").toContain("var(--crit)");
    const row = screen.getByRole("button", { name: /Key committed/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("A live key is in the config")).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("A live key is in the config")).toBeTruthy();
    fireEvent.click(row);
    expect(screen.queryByText("A live key is in the config")).toBeNull();

    cleanup();
    setBrief({ risks: { risks: [] } });
    renderCard();
    expect(screen.getByText("No notable risks flagged.")).toBeTruthy();
  });

  it("renders a focus item and navigates with file and line", () => {
    renderCard();
    expect(screen.getByText("src/config.ts:12 — live key committed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /src\/config\.ts:12/ }));
    expect(onNavigate).toHaveBeenCalledWith("/repos/r1/pulls/482?tab=diff&file=src%2Fconfig.ts&line=12");
  });

  it("navigates from a risk file ref without a line", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "src/config.ts" }));
    expect(onNavigate).toHaveBeenCalledWith("/repos/r1/pulls/482?tab=diff&file=src%2Fconfig.ts");
  });

  it("does not navigate for a file outside the diff", () => {
    renderCard();
    const item = screen.getByText("src/other.ts:3 — blast only");
    expect(screen.getAllByText("File not in this PR's diff").length).toBeGreaterThan(0);
    fireEvent.click(item);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /src\/other\.ts/ })).toBeNull();
  });

  it("shows empty review focus copy", () => {
    setBrief({ review_focus: [] });
    renderCard();
    expect(screen.getByText("No review focus suggested.")).toBeTruthy();
  });

  it("offers Generate (no auto POST) when there is no brief", () => {
    hookState = { data: { pr_id: "p1", current_head_sha: "x", brief: null, stale: false, generating: false } };
    renderCard();
    expect(screen.getByText("Brief not available yet.")).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(generate).toHaveBeenCalledWith("refresh");
  });

  it("shows a skeleton and a disabled Generate while the first brief is pending", () => {
    hookState = {
      data: { pr_id: "p1", current_head_sha: "x", brief: null, stale: false, generating: true },
      pending: true,
    };
    renderCard();
    expect(screen.getByTestId("brief-skeleton")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Generate brief" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the previous brief with an Updating badge and disabled refresh while pending", () => {
    setBrief({}, { pending: true });
    renderCard();
    expect(screen.getByText(baseBrief.summary)).toBeTruthy();
    expect(screen.getByText("Updating…").closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect((screen.getByRole("button", { name: "Refresh brief" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server error with Retry, keeps the previous brief, and hints on missing_key", () => {
    const err = Object.assign(new Error("OPENROUTER_API_KEY is not configured"), {
      details: { reason: "missing_key" },
    });
    setBrief({}, { error: err });
    renderCard();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("OPENROUTER_API_KEY is not configured");
    expect(within(alert).getByRole("link", { name: "Open Settings" })).toBeTruthy();
    expect(screen.getByText(baseBrief.summary)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("omits the settings hint for other failures", () => {
    setBrief({}, { error: Object.assign(new Error("provider down"), { details: { reason: "provider_error" } }) });
    renderCard();
    expect(screen.getByRole("alert").textContent).toContain("provider down");
    expect(screen.queryByRole("link", { name: "Open Settings" })).toBeNull();
  });
});

describe("buildDiffHref", () => {
  it("encodes the file and appends line only when given", () => {
    expect(buildDiffHref("r", 1, "a b/c.ts")).toBe("/repos/r/pulls/1?tab=diff&file=a%20b%2Fc.ts");
    expect(buildDiffHref("r", 1, "a.ts", 5)).toBe("/repos/r/pulls/1?tab=diff&file=a.ts&line=5");
  });
});
