import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RiskBadge, riskLevelFromScore } from "./risk-badge";

describe("riskLevelFromScore", () => {
  it("maps scores onto levels with the platform thresholds", () => {
    expect(riskLevelFromScore(0)).toBe("low");
    expect(riskLevelFromScore(0.39)).toBe("low");
    expect(riskLevelFromScore(0.4)).toBe("medium");
    expect(riskLevelFromScore(0.69)).toBe("medium");
    expect(riskLevelFromScore(0.7)).toBe("high");
    expect(riskLevelFromScore(1)).toBe("high");
  });
});

describe("RiskBadge", () => {
  it("derives the level from a score", () => {
    render(<RiskBadge score={0.82} />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("data-level", "high");
    expect(badge).toHaveTextContent("82%");
  });

  it("respects an explicit level", () => {
    render(<RiskBadge level="medium" />);
    expect(screen.getByRole("status")).toHaveAttribute("data-level", "medium");
  });

  it("uses a localized label when provided", () => {
    render(<RiskBadge level="high" label="גבוה" score={0.9} />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("גבוה");
    expect(badge).toHaveAccessibleName("גבוה risk, 90 percent");
  });
});
