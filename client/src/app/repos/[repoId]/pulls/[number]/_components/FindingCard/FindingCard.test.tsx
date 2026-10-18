import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { ApiError } from "../../../../../../../lib/api";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../../../../../../lib/toast", () => ({ notify: toast }));

import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-10-15T10:00:00Z" };
const EVAL_BTN = { name: "Turn into eval case" };

describe("FindingCard 'Turn into eval case'", () => {
  beforeEach(() => vi.clearAllMocks());

  it("orders the actions Accept, Dismiss, Turn into eval case", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onCreateEvalCase={vi.fn()} />);
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names.slice(-3)).toEqual(["Accept", "Dismiss", "Turn into eval case"]);
  });

  it("renders no button without a handler", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded />);
    expect(screen.queryByRole("button", EVAL_BTN)).not.toBeInTheDocument();
  });

  it("is disabled and described by a hint while undecided", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onCreateEvalCase={vi.fn()} />);
    const btn = screen.getByRole("button", EVAL_BTN);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription("Accept or dismiss the finding first");
  });

  it("is disabled 'In eval set' when eval_case_id is set", () => {
    renderWithIntl(
      <FindingCard f={{ ...ACCEPTED, eval_case_id: "c1" }} defaultExpanded onCreateEvalCase={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "In eval set" })).toBeDisabled();
  });

  it("follows eval_case_id: in set after a create, back to the action once it is null again", async () => {
    const create = vi.fn().mockResolvedValue({ id: "c1" });
    const ui = (f: FindingRecord) => (
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={f} defaultExpanded onCreateEvalCase={create} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui(ACCEPTED));
    fireEvent.click(screen.getByRole("button", EVAL_BTN));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    rerender(ui({ ...ACCEPTED, eval_case_id: "c1" }));
    expect(screen.getByRole("button", { name: "In eval set" })).toBeDisabled();
    rerender(ui({ ...ACCEPTED, eval_case_id: null }));
    expect(await screen.findByRole("button", EVAL_BTN)).toBeEnabled();
  });

  it("toasts on success and shows 'In eval set' once the cache carries eval_case_id", async () => {
    const create = vi.fn().mockResolvedValue({ id: "c1" });
    const ui = (f: FindingRecord) => (
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={f} defaultExpanded onCreateEvalCase={create} agentName="Security Agent" />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui(ACCEPTED));
    fireEvent.click(screen.getByRole("button", EVAL_BTN));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Eval case created for Security Agent"),
    );
    rerender(ui({ ...ACCEPTED, eval_case_id: "c1" }));
    expect(screen.getByRole("button", { name: "In eval set" })).toBeDisabled();
  });

  it("makes one call for two rapid clicks", async () => {
    const create = vi.fn().mockResolvedValue({ id: "c1" });
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onCreateEvalCase={create} />);
    const btn = screen.getByRole("button", EVAL_BTN);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["finding_undecided", "Accept or dismiss the finding first"],
    ["agent_missing", "The agent that produced this finding was deleted"],
    ["file_not_in_diff", "File is not in the PR diff"],
    ["diff_too_large", "Diff section is too large"],
    ["something_else", "Could not create the eval case"],
  ])("maps error code %s to its copy and keeps the button enabled", async (code, copy) => {
    const create = vi.fn().mockRejectedValue(new ApiError("boom", 400, code));
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onCreateEvalCase={create} />);
    fireEvent.click(screen.getByRole("button", EVAL_BTN));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy));
    expect(screen.getByRole("button", EVAL_BTN)).toBeEnabled();
  });

  it("toasts on 409 already_eval_case and never sticks on 'In eval set' without the prop", async () => {
    const create = vi.fn().mockRejectedValue(new ApiError("dup", 409, "already_eval_case"));
    renderWithIntl(<FindingCard f={ACCEPTED} defaultExpanded onCreateEvalCase={create} />);
    fireEvent.click(screen.getByRole("button", EVAL_BTN));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Already an eval case"));
    expect(screen.queryByRole("button", { name: "In eval set" })).not.toBeInTheDocument();
  });
});
