import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const mocks = vi.hoisted(() => ({
  reviews: [] as unknown[],
  smartDiff: undefined as unknown,
  mutate: vi.fn(),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => ({ data: mocks.reviews }),
  useSmartDiff: () => ({ data: mocks.smartDiff }),
  useFindingAction: () => ({ isPending: false, mutate: mocks.mutate }),
}));

import { DiffTab } from "./DiffTab";

const PATCH = "@@ -1,2 +1,3 @@\n a\n+b\n c";

const FILES: PrFile[] = [
  { path: "README.md", additions: 1, deletions: 0, patch: null },
  { path: "src/a.ts", additions: 1, deletions: 0, patch: PATCH },
  { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: null },
  { path: "src/index.ts", additions: 1, deletions: 0, patch: null },
  { path: "src/a.test.ts", additions: 1, deletions: 0, patch: null },
];

function sf(path: string, lines: number[] = []) {
  return { path, additions: 1, deletions: 0, finding_lines: lines };
}
const SMART: SmartDiff = {
  groups: [
    { role: "core", files: [sf("src/a.ts", [2, 3])] },
    { role: "tests", files: [sf("src/a.test.ts")] },
    { role: "wiring", files: [sf("src/index.ts")] },
    { role: "docs", files: [sf("README.md")] },
    { role: "boilerplate", files: [sf("pnpm-lock.yaml")] },
  ],
  split_suggestion: { too_big: false, total_lines: 5, proposed_splits: [] },
};

function finding(id: string, line: number, title: string): FindingRecord {
  return {
    id,
    severity: "WARNING",
    category: "bug",
    title,
    file: "src/a.ts",
    start_line: line,
    end_line: line,
    rationale: `why ${id}`,
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

const REVIEW = {
  id: "r1",
  pr_id: "pr",
  agent_id: "ag",
  run_id: null,
  kind: "review",
  verdict: null,
  summary: null,
  score: null,
  model: null,
  created_at: "2026-01-01T00:00:00Z",
  findings: [finding("f1", 2, "Null deref"), finding("f2", 3, "Off by one")],
} as unknown as ReviewRecord;

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr" filesCount={FILES.length} files={FILES} canComment />
    </NextIntlClientProvider>,
  );
}

const ROLES = ["core", "tests", "wiring", "docs", "boilerplate"];

beforeEach(() => {
  mocks.reviews = [REVIEW];
  mocks.smartDiff = SMART;
  mocks.mutate.mockClear();
});
afterEach(cleanup);

describe("DiffTab smart diff", () => {
  it("groups files by role, counts finding files, and shows findings under the line", () => {
    renderTab();

    const groups = ROLES.map((r) => screen.getByTestId(`smart-diff-group-${r}`));
    // DOM order == ROLE_ORDER
    groups.forEach((g, i) => {
      if (i > 0) {
        expect(groups[i - 1]!.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });
    expect(within(groups[0]!).getByText("Core")).toBeInTheDocument();
    expect(within(groups[0]!).getByText("1 files")).toBeInTheDocument();
    expect(within(groups[1]!).getByText("Tests")).toBeInTheDocument();
    expect(within(groups[3]!).getByText("Docs")).toBeInTheDocument();

    // lock file lives in boilerplate; docs/boilerplate collapsed, core expanded
    expect(within(groups[4]!).getByRole("button", { name: "Boilerplate" })).toHaveAttribute("aria-expanded", "false");
    expect(within(groups[3]!).getByRole("button", { name: "Docs" })).toHaveAttribute("aria-expanded", "false");
    expect(within(groups[0]!).getByRole("button", { name: "Core" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(within(groups[0]!).getByText("src/a.ts")).toBeInTheDocument();

    // two finding lines in one file -> counter 1; dot on the file card
    expect(within(groups[0]!).getByTestId("smart-diff-group-findings")).toHaveTextContent("1");
    expect(screen.getAllByTestId("file-finding-dot")).toHaveLength(1);
    expect(screen.queryByText(prReview.smartDiff.noReviewYet)).not.toBeInTheDocument();

    // findings hidden until the comments toggle is switched on
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show comments/ }));
    expect(screen.getByText("Null deref")).toBeInTheDocument();
    expect(screen.getByText("why f1")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]!);
    expect(mocks.mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr" });

    fireEvent.click(screen.getByRole("button", { name: /Hide comments/ }));
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
  });

  it("switches to original order without group headers and back", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByTestId("smart-diff-group-core")).not.toBeInTheDocument();
    const paths = screen
      .getAllByText(/^(src\/.*|README\.md|pnpm-lock\.yaml)$/)
      .map((el) => el.textContent);
    expect(paths).toEqual(FILES.map((f) => f.path));

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getByTestId("smart-diff-group-core")).toBeInTheDocument();
  });

  it("before the first review renders all groups with the empty-state note and no counters", () => {
    mocks.reviews = [];
    renderTab();
    ROLES.forEach((r) => expect(screen.getByTestId(`smart-diff-group-${r}`)).toBeInTheDocument());
    expect(screen.getByText(prReview.smartDiff.noReviewYet)).toBeInTheDocument();
    expect(screen.queryByTestId("smart-diff-group-findings")).not.toBeInTheDocument();
  });
});
