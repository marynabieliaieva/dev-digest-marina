import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../../messages/en/skills.json";
import pickerMessages from "../../../../../../messages/en/contextPicker.json";

const setMutate = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { full_name: "acme/payments-api" } }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useContextDocs: () => ({
    isLoading: false,
    isError: false,
    data: {
      roots: ["specs"],
      docs: [
        { path: "specs/public-api.md", type: "specs", size: 1000, est_tokens: 250, updated_at: "2026-01-01T00:00:00Z", used_by_agents: 0, used_by: [] },
      ],
    },
  }),
  useSkillContext: () => ({ isLoading: false, isError: false, data: { paths: ["specs/public-api.md"] } }),
  useSetSkillContext: () => ({ mutate: setMutate }),
  useContextDoc: () => ({ data: undefined, isLoading: true }),
}));

import { SkillContextTab } from "./SkillContextTab";

afterEach(cleanup);

describe("SkillContextTab", () => {
  it("renders title, subtitle, count badge and the serialized block", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages, contextPicker: pickerMessages }}>
        <SkillContextTab skill={{ id: "s1" } as Skill} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Project context to use")).toBeTruthy();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeTruthy();
    expect(screen.getByText("1 attached")).toBeTruthy();
    expect(screen.getByTestId("serialize-preview").textContent).toBe(
      "## Project context\n- specs/public-api.md",
    );
  });
});
