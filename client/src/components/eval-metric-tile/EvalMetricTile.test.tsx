import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/eval.json";
import { EvalMetricTile } from "./EvalMetricTile";

afterEach(cleanup);

function renderTile(props: React.ComponentProps<typeof EvalMetricTile>) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalMetricTile {...props} />
    </NextIntlClientProvider>,
  );
}

describe("EvalMetricTile", () => {
  it("renders value, delta and a sparkline labelled with the latest value", () => {
    renderTile({ label: "Recall", value: 0.85, previous: 0.87, spark: [0.8, 0.87, 0.85] });
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("−2 pts")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Recall trend, latest 85%" })).toBeInTheDocument();
  });

  it("shows a dash delta when the previous value is null", () => {
    renderTile({ label: "Precision", value: 0.9, previous: null });
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a dash value for null and honours text overrides", () => {
    renderTile({ label: "Traces passed", value: null, valueText: "3/4", deltaText: "+1" });
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
