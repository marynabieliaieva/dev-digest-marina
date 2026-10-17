import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { EvalCompare } from "@devdigest/shared";

let compare: EvalCompare;
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCompare: () => ({ data: compare, isError: false, error: null }),
}));

import { renderWithProviders, makeBatch, userEvent } from "../../../testing";
import { CompareModal } from "./CompareModal";

afterEach(cleanup);

const snap = (model: string, skills: string[]) => ({
  provider: "openai",
  model,
  system_prompt: "p",
  strategy: "single",
  skills: skills.map((name) => ({ name, body: "" })),
});

const make = (over: Partial<EvalCompare> = {}): EvalCompare => ({
  base: makeBatch({ id: "b1", agent_version: 6, recall: 0.78, cost_usd: 0.21, config_snapshot: snap("gpt-4o", []) }),
  head: makeBatch({ id: "b2", agent_version: 7, recall: 0.82, cost_usd: 0.23, config_snapshot: snap("gpt-4.1", ["sql"]) }),
  delta: { recall: 0.04, precision: null, citation_accuracy: 0.01, cost_usd: 0.02 },
  prompt_diff: [
    { op: "same", text: "You are a reviewer." },
    { op: "del", text: "Return at most 5 findings." },
    { op: "add", text: "Flag unused imports." },
  ],
  model_changed: true,
  ...over,
});

function Harness({ onClose }: { onClose: () => void }) {
  return (
    <>
      <button>Compare</button>
      <CompareModal base="b1" head="b2" onClose={onClose} />
    </>
  );
}

describe("CompareModal", () => {
  it("shows title, tiles with em-dash on null, diff markers, model and skills lines", () => {
    compare = make();
    renderWithProviders(<CompareModal base="b1" head="b2" onClose={vi.fn()} />);

    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();
    expect(screen.getByText("78% → 82%")).toBeInTheDocument();
    expect(screen.getByText("+4 pts")).toBeInTheDocument();
    expect(screen.getByText("$0.2100 → $0.2300")).toBeInTheDocument();
    expect(screen.getByText("+$0.0200")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1); // precision delta is null

    expect(screen.getByText("−")).toBeInTheDocument();
    expect(screen.getByText("+")).toBeInTheDocument();
    expect(screen.getByText("Return at most 5 findings.")).toBeInTheDocument();
    expect(screen.getByText("Flag unused imports.")).toBeInTheDocument();
    expect(screen.queryByText("System prompt unchanged")).not.toBeInTheDocument();
    expect(screen.getByText("Model: gpt-4o → gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("Skills: none → sql")).toBeInTheDocument();
  });

  it("says the prompt is unchanged and hides model/skills lines when nothing differs", () => {
    compare = make({
      prompt_diff: [{ op: "same", text: "x" }],
      model_changed: false,
      base: makeBatch({ id: "b1", agent_version: 6, config_snapshot: snap("gpt-4.1", ["sql"]) }),
      head: makeBatch({ id: "b2", agent_version: 7, config_snapshot: snap("gpt-4.1", ["sql"]) }),
    });
    renderWithProviders(<CompareModal base="b1" head="b2" onClose={vi.fn()} />);

    expect(screen.getByText("System prompt unchanged")).toBeInTheDocument();
    expect(screen.queryByText(/^Model:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Skills:/)).not.toBeInTheDocument();
  });

  it("closes on Close, Escape and backdrop, returning focus to the trigger", async () => {
    compare = make();
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<Harness onClose={onClose} />);

    await user.click(screen.getAllByRole("button", { name: "Close" })[1]!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("dialog").previousElementSibling!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("returns focus to the opener when unmounted", async () => {
    compare = make();
    const user = userEvent.setup();
    function Toggle() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Compare</button>
          {open && <CompareModal base="b1" head="b2" onClose={() => setOpen(false)} />}
        </>
      );
    }
    renderWithProviders(<Toggle />);

    const trigger = screen.getByRole("button", { name: "Compare" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
