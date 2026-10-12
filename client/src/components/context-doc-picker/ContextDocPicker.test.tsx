import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDoc } from "@devdigest/shared";
import messages from "../../../messages/en/contextPicker.json";
import { ContextDocPicker } from "./ContextDocPicker";

vi.mock("@/lib/hooks/project-context", () => ({
  useContextDoc: () => ({ data: { path: "specs/a.md", content: "# Hello", size: 7, est_tokens: 2 }, isLoading: false }),
}));

afterEach(cleanup);

const doc = (path: string, est_tokens: number, size = 1000): ContextDoc => ({
  path,
  type: "specs",
  size,
  est_tokens,
  updated_at: "2026-01-01T00:00:00Z",
  used_by_agents: 0,
  used_by: [],
});

function renderPicker(props: Partial<React.ComponentProps<typeof ContextDocPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ contextPicker: messages }}>
      <ContextDocPicker
        docs={[doc("specs/a.md", 100), doc("specs/rate-limiting.md", 250)]}
        attached={["specs/a.md"]}
        onChange={onChange}
        repoId="r1"
        repoName="acme/payments-api"
        badgeVariant="ofTotal"
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("ContextDocPicker", () => {
  it("filters rows by path but the badge still counts all attached", () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText("Filter documents…"), { target: { value: "rate" } });
    expect(screen.getByText("rate-limiting.md")).toBeInTheDocument();
    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
  });

  it("toggling a doc adds it and the total reflects its tokens", () => {
    const onChange = renderPicker();
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(onChange).toHaveBeenCalledWith(["specs/a.md", "specs/rate-limiting.md"]);
  });

  it("total tokens go up by 250 when a 1,000-char doc is toggled on, and back down when off", () => {
    function Stateful() {
      const [attached, setAttached] = useState<string[]>(["specs/a.md"]);
      return (
        <NextIntlClientProvider locale="en" messages={{ contextPicker: messages }}>
          <ContextDocPicker
            docs={[doc("specs/a.md", 100), doc("specs/rate-limiting.md", 250, 1000)]}
            attached={attached}
            onChange={setAttached}
            repoId="r1"
            repoName="acme/payments-api"
            badgeVariant="ofTotal"
          />
        </NextIntlClientProvider>
      );
    }
    render(<Stateful />);
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("≈ 350 tokens")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();
  });

  it("shows too-large badge while the checkbox stays enabled", () => {
    renderPicker({ docs: [doc("big.md", 20000, 70 * 1024)], attached: [] });
    expect(screen.getByText("Too large — will be skipped")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows the over-budget warning for an agent above 20k tokens", () => {
    renderPicker({ docs: [doc("a.md", 21000)], attached: ["a.md"], budgetWarning: true });
    expect(screen.getByText(/over the 20k budget/)).toBeInTheDocument();
  });

  it("renders a missing attached path with 0 tokens and unchecking removes it", () => {
    const onChange = renderPicker({ attached: ["specs/a.md", "gone.md"] });
    expect(screen.getByText("missing in acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("≈ 100 tokens")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]!);
    expect(onChange).toHaveBeenCalledWith(["specs/a.md"]);
  });

  it("renders inherited rows read-only with a via label", () => {
    const onChange = renderPicker({ inherited: [{ path: "specs/rate-limiting.md", skill_name: "rubric" }] });
    expect(screen.getByText("via rubric")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Esc closes the preview and focus returns to the Preview button", () => {
    renderPicker();
    const btn = screen.getAllByRole("button", { name: /^Preview specs\/a\.md/ })[0]!;
    btn.focus();
    fireEvent.click(btn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(btn);
  });
});
