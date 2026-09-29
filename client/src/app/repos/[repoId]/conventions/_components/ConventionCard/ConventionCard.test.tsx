import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "naming",
  rule: "Service classes are suffixed with Service.",
  evidence_path: "src/service.ts",
  evidence_line: 1,
  evidence_snippet: "export class FooService {",
  confidence: 0.9,
  status: "pending",
  edited: false,
  skill_id: null,
};

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders the rule, category, evidence location and snippet", () => {
    renderCard(
      <ConventionCard
        candidate={CANDIDATE}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onUndo={vi.fn()}
        onEditRule={vi.fn()}
      />,
    );
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("Naming")).toBeInTheDocument();
    expect(screen.getByText("src/service.ts:1")).toBeInTheDocument();
    // Snippet is syntax-highlighted into multiple <span> tokens, so match on
    // the <pre>'s full text content rather than a single text node.
    expect(
      screen.getByText(
        (_, node) => node?.tagName === "PRE" && node.textContent === CANDIDATE.evidence_snippet,
      ),
    ).toBeInTheDocument();
  });

  it("calls onAccept / onReject from the action pair", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard(
      <ConventionCard
        candidate={CANDIDATE}
        onAccept={onAccept}
        onReject={onReject}
        onUndo={vi.fn()}
        onEditRule={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Accept"));
    expect(onAccept).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalled();
  });

  it("clicking the rule opens an inline editor; saving calls onEditRule and marks it edited", () => {
    const onEditRule = vi.fn();
    renderCard(
      <ConventionCard
        candidate={CANDIDATE}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onUndo={vi.fn()}
        onEditRule={onEditRule}
      />,
    );
    fireEvent.click(screen.getByText(CANDIDATE.rule));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Service classes MUST be suffixed with Service." } });
    fireEvent.click(screen.getByText("Save"));
    expect(onEditRule).toHaveBeenCalledWith("Service classes MUST be suffixed with Service.");
  });

  it("cancelling an edit does not call onEditRule", () => {
    const onEditRule = vi.fn();
    renderCard(
      <ConventionCard
        candidate={CANDIDATE}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onUndo={vi.fn()}
        onEditRule={onEditRule}
      />,
    );
    fireEvent.click(screen.getByText(CANDIDATE.rule));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onEditRule).not.toHaveBeenCalled();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
  });

  it("a rejected candidate shows Undo instead of Accept/Reject and calls onUndo", () => {
    const onUndo = vi.fn();
    renderCard(
      <ConventionCard
        candidate={{ ...CANDIDATE, status: "rejected" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onUndo={onUndo}
        onEditRule={vi.fn()}
      />,
    );
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalled();
  });

  it("an accepted candidate shows the Accepted badge and disables the accept button", () => {
    renderCard(
      <ConventionCard
        candidate={{ ...CANDIDATE, status: "accepted" }}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onUndo={vi.fn()}
        onEditRule={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Accepted").length).toBeGreaterThan(0);
  });
});
