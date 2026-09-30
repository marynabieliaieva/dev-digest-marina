import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/intent.json";

const mutate = vi.fn();
let hookState: { data: unknown; isPending: boolean; error?: Error };

vi.mock("../../../../../../../lib/hooks/intent", () => ({
  usePrIntent: () => ({ data: hookState.data }),
  useDeriveIntent: () => ({
    mutate,
    isPending: hookState.isPending,
    isError: !!hookState.error,
    error: hookState.error ?? null,
  }),
}));

import { IntentCard } from "./IntentCard";

const baseIntent = {
  pr_id: "pr1",
  status: "ready",
  error: null,
  head_sha: "abc1234def",
  stale: false,
  summary: "Add rate limiting to the login endpoint",
  in_scope: ["Login route throttle"],
  out_of_scope: ["Password reset flow"],
  risk_areas: ["Auth middleware"],
  confidence: "high",
  missing_context: [] as string[],
  sources: [
    { kind: "repo_doc", ref: "docs/plans/foo.md", status: "used", chars: 10, sha256: null, reason: null },
  ],
};

function setIntent(over: Record<string, unknown> | null, isPending = false) {
  hookState = {
    isPending,
    data: {
      pr_id: "pr1",
      current_head_sha: "abc1234def",
      intent: over === null ? null : { ...baseIntent, ...over },
    },
  };
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ intent: messages }}>
      <IntentCard prId="pr1" />
    </NextIntlClientProvider>,
  );
}

/** The block a section heading introduces (the heading's parent element). */
function sectionUnder(heading: string): HTMLElement {
  const el = screen.getByRole("heading", { name: heading }).parentElement;
  if (!el) throw new Error(`no container for heading "${heading}"`);
  return el;
}

beforeEach(() => {
  mutate.mockReset();
  setIntent({});
});
afterEach(cleanup);

describe("IntentCard", () => {
  it("renders the ready state", () => {
    renderCard();
    expect(screen.getByText(baseIntent.summary).closest("blockquote")).not.toBeNull();
    expect(screen.getByText("Login route throttle")).toBeTruthy();
    expect(screen.getByText("Password reset flow")).toBeTruthy();
    expect(screen.getByText("Auth middleware")).toBeTruthy();
    expect(screen.getByText(/Confidence: High/)).toBeTruthy();
    expect(screen.getByText("docs/plans/foo.md")).toBeTruthy();
    expect(screen.getByText("Used")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Missing context" })).toBeNull();

    // each item sits under its own heading, not the other one
    const inScope = sectionUnder("In scope");
    const outOfScope = sectionUnder("Out of scope");
    expect(within(inScope).getByRole("listitem").textContent).toBe("Login route throttle");
    expect(within(inScope).queryByText("Password reset flow")).toBeNull();
    expect(within(outOfScope).getByRole("listitem").textContent).toBe("Password reset flow");
    expect(within(outOfScope).queryByText("Login route throttle")).toBeNull();

    // risk areas render as chips (not list items) under the "Risk areas" heading
    const risks = sectionUnder("Risk areas");
    expect(within(risks).getByText("Auth middleware").tagName).toBe("SPAN");
    expect(within(risks).queryByRole("listitem")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("lists missing context", () => {
    const text = "https://acme.atlassian.net/browse/ABC-1 (unsupported): requires authenticated integration";
    setIntent({ missing_context: [text] });
    renderCard();
    const region = screen.getByRole("region", { name: "Missing context" });
    expect(within(region).getByText(text)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows a stale banner and re-derives on click", () => {
    setIntent({ stale: true });
    renderCard();
    expect(screen.getByRole("status").textContent).toContain("abc1234");
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("disables the button while deriving", () => {
    setIntent({}, true);
    renderCard();
    // tells the user it is working and may take a while, instead of spinning silently
    expect(screen.getByRole("status").textContent).toContain("a minute or two");
    const btn = screen.getByRole("button", { name: "Computing…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // the refresh icon must actually spin while deriving (Button `loading` prop)
    expect(btn.querySelector("svg")?.getAttribute("style") ?? "").toContain("ddspin");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows the error for a failed derivation without scope columns", () => {
    setIntent({ status: "failed", error: "OPENROUTER_API_KEY is not configured" });
    renderCard();
    expect(screen.getByText(/OPENROUTER_API_KEY is not configured/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeTruthy();
    expect(screen.queryByText("In scope")).toBeNull();
    expect(screen.queryByText("Out of scope")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows an error when the recompute request itself fails, and lets the user retry", () => {
    setIntent({});
    hookState.error = new Error("Request timed out");
    renderCard();
    expect(screen.getByRole("alert").textContent).toContain("Request timed out");
    expect(screen.getByRole("button", { name: "Recompute" })).toBeTruthy();
  });

  it("shows the empty state and derives on click", () => {
    setIntent(null);
    renderCard();
    expect(screen.getByText("Intent not derived yet")).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Derive intent" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
