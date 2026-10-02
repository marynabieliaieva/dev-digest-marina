import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const mocks = vi.hoisted(() => ({
  reviews: [] as unknown[],
  smartDiff: undefined as unknown,
  comments: [] as unknown[],
  runs: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: mocks.comments }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => ({ data: mocks.reviews }),
  usePrRuns: () => ({ data: mocks.runs }),
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
  mocks.comments = [];
  mocks.runs = [];
  mocks.mutate.mockClear();
});
afterEach(cleanup);

describe("DiffTab smart diff", () => {
  it("groups files by role, counts finding files, and shows findings under the line", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));

    const groups = ROLES.map((r) => screen.getByTestId(`smart-diff-group-${r}`));
    // DOM order == ROLE_ORDER
    groups.forEach((g, i) => {
      if (i > 0) {
        expect(groups[i - 1]!.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });
    ["Core", "Tests", "Wiring", "Docs", "Boilerplate"].forEach((label, i) => {
      expect(within(groups[i]!).getByText(label)).toBeInTheDocument();
      expect(within(groups[i]!).getByText("1 files")).toBeInTheDocument();
    });

    // lock file lives in boilerplate; docs/boilerplate collapsed, core expanded
    expect(within(groups[4]!).getByRole("button", { name: "Boilerplate" })).toHaveAttribute("aria-expanded", "false");
    expect(within(groups[3]!).getByRole("button", { name: "Docs" })).toHaveAttribute("aria-expanded", "false");
    expect(within(groups[0]!).getByRole("button", { name: "Core" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(within(groups[0]!).getByText("src/a.ts")).toBeInTheDocument();

    // two finding lines in one file -> counter 1; dot on the file card
    // two WARNING findings -> only the warning chip (amber), "2"; no blocker/suggestion chips
    expect(within(groups[0]!).getByTestId("smart-diff-group-sev-WARNING")).toHaveTextContent("2");
    expect(within(groups[0]!).getByTestId("smart-diff-group-sev-WARNING")).toHaveStyle({ color: "var(--warn)" });
    expect(within(groups[0]!).queryByTestId("smart-diff-group-sev-CRITICAL")).not.toBeInTheDocument();
    expect(within(groups[0]!).queryByTestId("smart-diff-group-sev-SUGGESTION")).not.toBeInTheDocument();
    expect(within(groups[1]!).getByTestId("smart-diff-group-findings")).toHaveTextContent("● 0");
    expect(screen.getAllByTestId("file-finding-dot")).toHaveLength(1);
    expect(screen.queryByText(prReview.smartDiff.noReviewYet)).not.toBeInTheDocument();

    // expanding boilerplate reveals the lock file inside that group
    fireEvent.click(within(groups[4]!).getByRole("button", { name: "Boilerplate" }));
    expect(within(groups[4]!).getByText("pnpm-lock.yaml")).toBeInTheDocument();

    // findings are visible by default (review has findings), no extra click
    expect(screen.getByText("Null deref")).toBeInTheDocument();
    expect(screen.getByText("why f1")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]!);
    expect(mocks.mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr" });

    fireEvent.click(screen.getByRole("button", { name: /Hide findings/ }));
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show findings/ }));
    expect(screen.getByText("Null deref")).toBeInTheDocument();
  });

  it("defaults to original order, switches to smart order and back", () => {
    renderTab();
    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(prReview.smartDiff.originalOrdered)).toBeInTheDocument();
    expect(screen.queryByTestId("smart-diff-group-core")).not.toBeInTheDocument();
    const paths = screen
      .getAllByText(/^(src\/[^:]*|README\.md|pnpm-lock\.yaml)$/)
      .map((el) => el.textContent);
    expect(paths).toEqual(FILES.map((f) => f.path));

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getByTestId("smart-diff-group-core")).toBeInTheDocument();
    expect(screen.getByText(prReview.smartDiff.reviewerOrdered)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByTestId("smart-diff-group-core")).not.toBeInTheDocument();
  });

  it("before the first review renders all groups with the empty-state note and no counters", () => {
    mocks.reviews = [];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    ROLES.forEach((r) => expect(screen.getByTestId(`smart-diff-group-${r}`)).toBeInTheDocument());
    expect(screen.getByText(prReview.smartDiff.noReviewYet)).toBeInTheDocument();
    expect(screen.queryByTestId("smart-diff-group-findings")).not.toBeInTheDocument();
  });
});

describe("DiffTab token usage", () => {
  const run = (id: string, agent: string, status: string, at: string, tin: number, tout: number, cost: number) => ({
    run_id: id, agent_id: agent, status, ran_at: at, tokens_in: tin, tokens_out: tout, cost_usd: cost,
  });

  it("sums the newest finished run per agent and ignores failed / older runs", () => {
    mocks.runs = [
      run("1", "a", "done", "2026-01-02", 42000, 600, 0.0012),
      run("2", "a", "done", "2026-01-01", 99000, 9000, 0.5), // older run of the same agent
      run("3", "b", "done", "2026-01-02", 41000, 1900, 0.0013),
      run("4", "b", "failed", "2026-01-03", 0, 0, 0),
    ];
    renderTab();
    const line = screen.getByTestId("review-token-usage");
    expect(line).toHaveTextContent(prReview.smartDiff.tokensSpent);
    expect(line).toHaveTextContent("83k→2.5k"); // 42k+41k in, 0.6k+1.9k out
    expect(line).toHaveTextContent("2 agents");
  });

  it("is hidden when no run has finished", () => {
    mocks.runs = [run("1", "a", "running", "2026-01-02", 0, 0, 0)];
    renderTab();
    expect(screen.queryByTestId("review-token-usage")).not.toBeInTheDocument();
  });
});

describe("DiffTab group expand / collapse", () => {
  it("a group's own button collapses only that group's files, keeping the section open", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    const core = screen.getByTestId("smart-diff-group-core");
    fireEvent.click(within(core).getByRole("button", { name: "Collapse all files in this group" }));
    expect(within(core).getByRole("button", { name: "Core" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
    fireEvent.click(within(core).getByRole("button", { name: "Expand all files in this group" }));
    expect(screen.getByText("Null deref")).toBeInTheDocument();
  });
});

describe("DiffTab robustness", () => {
  it("renders PR files that no smart-diff group lists (under core)", () => {
    mocks.smartDiff = {
      ...SMART,
      groups: SMART.groups.map((g) => (g.role === "core" ? { ...g, files: [] } : g)),
    };
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    const core = screen.getByTestId("smart-diff-group-core");
    // src/a.ts is in the PR but no group lists it -> still shown in core
    expect(within(core).getByText("src/a.ts")).toBeInTheDocument();
  });

  it("one toggle click flips findings and GitHub comments together", () => {
    mocks.comments = [
      {
        id: 1,
        path: "src/a.ts",
        line: 3,
        original_line: 3,
        side: "RIGHT",
        body: "gh comment body",
        user: "bob",
        created_at: "2026-01-01T00:00:00Z",
        html_url: "https://example.test/c/1",
        in_reply_to_id: null,
        is_outdated: false,
      },
    ];
    renderTab();
    // label counts findings only (2), not the 1 GitHub comment
    expect(screen.getByRole("button", { name: /Hide findings/ })).toHaveTextContent("(2)");
    // default: findings visible, GitHub comments hidden, label offers to hide
    expect(screen.getByText("Null deref")).toBeInTheDocument();
    expect(screen.queryByText("gh comment body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide findings/ }));
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
    expect(screen.queryByText("gh comment body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show findings/ }));
    expect(screen.getByText("Null deref")).toBeInTheDocument();
    expect(screen.getByText("gh comment body")).toBeInTheDocument();
  });
});
