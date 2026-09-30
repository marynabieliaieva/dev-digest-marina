import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import messages from "../../../../messages/en/shell.json";
import type { DiffCommentApi } from "../comments";
import type { DiffFinding, DiffFindingApi } from "../findings";
import { FileCard } from "./FileCard";

afterEach(cleanup);

const PATCH = [
  "@@ -1,3 +1,4 @@",
  " one",
  "+two",
  " three",
  " four",
  "@@ -20,2 +21,3 @@",
  " twenty",
  "+twenty-two",
  " end",
].join("\n");

const FILE: PrFile = { path: "src/a.ts", additions: 2, deletions: 0, patch: PATCH };

function f(id: string, start_line: number, severity: DiffFinding["severity"]): DiffFinding {
  return { id, file: FILE.path, start_line, end_line: start_line, severity, title: `Title ${id}` };
}

function api(list: DiffFinding[], show = true): DiffFindingApi {
  return {
    byPath: new Map([[FILE.path, list]]),
    show,
    renderFinding: (x) => <div>{`Rationale for ${x.id}`}</div>,
  };
}

const COMMENTING: DiffCommentApi = {
  comments: [],
  canComment: false,
  showComments: true,
  posting: false,
  onSubmit: async () => undefined,
};

function renderCard(findings?: DiffFindingApi, file: PrFile = FILE, commenting?: DiffCommentApi) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      <FileCard file={file} findings={findings} commenting={commenting} />
    </NextIntlClientProvider>,
  );
}

describe("FileCard findings", () => {
  it("shows a number-less dot only for files with findings, independent of the comment counter", () => {
    renderCard(api([f("a", 2, "WARNING"), f("b", 22, "SUGGESTION")]), FILE, {
      ...COMMENTING,
      comments: [
        {
          id: 1,
          path: FILE.path,
          line: 2,
          side: "RIGHT",
          in_reply_to_id: null,
          created_at: "2026-01-01T00:00:00Z",
          body: "hi",
          user: "u",
        } as never,
      ],
    });
    const dot = screen.getByTestId("file-finding-dot");
    expect(screen.getAllByTestId("file-finding-dot")).toHaveLength(1);
    expect(dot.textContent).not.toMatch(/\d/);
    // comment counter still rendered separately
    expect(document.querySelector(".lucide-message-square")?.parentElement).toHaveTextContent("1");

    cleanup();
    renderCard(api([]));
    expect(screen.queryByTestId("file-finding-dot")).not.toBeInTheDocument();
  });

  it("renders inline cards under the line with stripe + label, collapsible, and outside findings", () => {
    renderCard(api([f("w", 2, "WARNING"), f("c", 22, "CRITICAL"), f("gone", 99, "WARNING")]));

    const warnRow = screen.getByText("two").closest("[data-finding-severity]") as HTMLElement;
    expect(warnRow).toHaveAttribute("data-finding-severity", "WARNING");
    expect(within(warnRow).getByTestId("finding-line-label")).toHaveTextContent("warning");
    // card is the next sibling of the row
    const inline = warnRow.nextElementSibling as HTMLElement;
    expect(inline).toHaveAttribute("data-testid", "diff-finding-inline");
    expect(within(inline).getByText("Rationale for w")).toBeInTheDocument();

    const critRow = screen.getByText("twenty-two").closest("[data-finding-severity]") as HTMLElement;
    expect(within(critRow).getByTestId("finding-line-label")).toHaveTextContent("blocker");

    const outside = screen.getByTestId("diff-findings-outside");
    expect(within(outside).getByText("Rationale for gone")).toBeInTheDocument();

    fireEvent.click(within(inline).getByRole("button"));
    expect(within(inline).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(within(inline).queryByText("Rationale for w")).not.toBeInTheDocument();
    expect(within(inline).getByText("Title w")).toBeInTheDocument();
  });

  it("hides inline UI when show is false but keeps the dot; no findings prop means no finding markup", () => {
    renderCard(api([f("w", 2, "WARNING"), f("gone", 99, "WARNING")], false));
    expect(screen.getByTestId("file-finding-dot")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-finding-inline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diff-findings-outside")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finding-line-label")).not.toBeInTheDocument();
    expect(document.querySelector("[data-finding-severity]")).toBeNull();

    cleanup();
    renderCard(undefined);
    expect(screen.queryByTestId("file-finding-dot")).not.toBeInTheDocument();
    expect(document.querySelector("[data-finding-severity]")).toBeNull();
  });

  it("puts every finding outside when the file has no patch", () => {
    renderCard(api([f("a", 1, "WARNING")]), { ...FILE, patch: null });
    expect(within(screen.getByTestId("diff-findings-outside")).getByText("Rationale for a")).toBeInTheDocument();
  });
});
