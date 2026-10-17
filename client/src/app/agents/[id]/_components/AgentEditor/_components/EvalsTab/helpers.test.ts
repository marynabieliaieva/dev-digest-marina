import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import type { EvalCaseDto } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import { resultText } from "./helpers";

const tr = createTranslator({ locale: "en", messages: { eval: messages }, namespace: "eval" });
const t = (key: string, values?: Record<string, string | number>) => tr(key as never, values as never);

function mk(type: "must_find" | "must_not_flag", last: EvalCaseDto["last_result"]): EvalCaseDto {
  return {
    id: "c1",
    owner_kind: "agent",
    owner_id: "a1",
    name: "n",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: null,
    source_finding_id: "f1",
    created_at: "2026-10-15T00:00:00Z",
    expectation: {
      type,
      file: "src/a.ts",
      start_line: 12,
      end_line: 14,
      kind: "finding",
      severity: "high",
      category: "security",
      title: "t",
      source_finding_id: "f1",
    },
    last_result: last,
  } as EvalCaseDto;
}

const ran = { pass: true, error: null, ran_at: "2026-10-15T00:00:00Z", actual_count: 2, matched_count: 1 };

describe("resultText", () => {
  it("must_find", () => {
    expect(resultText(mk("must_find", ran), t)).toBe("expected 1 finding at src/a.ts:12, got 1 matching");
  });
  it("must_not_flag", () => {
    expect(resultText(mk("must_not_flag", { ...ran, matched_count: 0 }), t)).toBe(
      "expected no finding at src/a.ts:12, got 0 matching",
    );
  });
  it("never run", () => {
    expect(resultText(mk("must_find", null), t)).toBe("never run");
  });
});
