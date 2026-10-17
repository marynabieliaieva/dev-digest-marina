import { describe, it, expect } from "vitest";
import { pct, deltaPts, usd, deltaUsd } from "./eval-format";

describe("eval-format", () => {
  it("pct rounds to 0 decimals and renders null as a dash", () => {
    expect(pct(0.874)).toBe("87%");
    expect(pct(1)).toBe("100%");
    expect(pct(null)).toBe("—");
  });

  it("deltaPts is signed in points, with a true minus sign", () => {
    expect(deltaPts(0.85, 0.87)).toBe("−2 pts");
    expect(deltaPts(0.9, 0.87)).toBe("+3 pts");
    expect(deltaPts(0.5, 0.5)).toBe("0 pts");
    expect(deltaPts(0.9, null)).toBe("—");
    expect(deltaPts(null, 0.9)).toBe("—");
  });

  it("usd has 4 decimals and a dash for null", () => {
    expect(usd(0.00123)).toBe("$0.0012");
    expect(usd(0)).toBe("$0.0000");
    expect(usd(null)).toBe("—");
  });

  it("deltaUsd is signed", () => {
    expect(deltaUsd(0.0042, 0.003)).toBe("+$0.0012");
    expect(deltaUsd(0.003, 0.0042)).toBe("−$0.0012");
    expect(deltaUsd(null, 0.003)).toBe("—");
  });
});
