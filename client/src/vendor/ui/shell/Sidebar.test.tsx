import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("Sidebar", () => {
  it("lists Eval Dashboard directly after Agents in SKILLS LAB, linking to /evals", () => {
    render(<Sidebar ctx={{ repoId: "r1", repos: [], activeRepo: null }} />);

    const link = screen.getByRole("link", { name: /Eval Dashboard/ });
    expect(link).toHaveAttribute("href", "/evals");

    const links = within(screen.getByText("SKILLS LAB").parentElement!).getAllByRole("link");
    const names = links.map((l) => l.textContent);
    const agentsAt = names.findIndex((n) => n?.includes("Agents"));
    expect(agentsAt).toBeGreaterThanOrEqual(0);
    expect(names[agentsAt + 1]).toContain("Eval Dashboard");
  });
});
