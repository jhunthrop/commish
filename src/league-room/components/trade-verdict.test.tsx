import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { TradeVerdict, type TradeAssessmentSummary } from "./trade-verdict";

const LOPSIDED: TradeAssessmentSummary = { verdict: "lopsided", givingValue: 42.5, receivingValue: 12 };
const EVEN: TradeAssessmentSummary = { verdict: "even", givingValue: 20, receivingValue: 19.5 };
const FAVORS_PROPOSER: TradeAssessmentSummary = { verdict: "favors_proposer", givingValue: 10, receivingValue: 20 };
const FAVORS_RECEIVER: TradeAssessmentSummary = { verdict: "favors_receiver", givingValue: 20, receivingValue: 10 };

describe("TradeVerdict", () => {
  it("says the verdict is about points per week and not about whether to do it, in both themes, axe-clean", async () => {
    await inBothThemes(<TradeVerdict assessment={LOPSIDED} />, async ({ container }) => {
      expect(screen.getByText(/weekly production/i)).toBeVisible();
      expect(screen.getByText(/a long way from even/i)).toBeVisible();
      expect(screen.getByText("Advice only. You decide.")).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("names a close trade as close", () => {
    const { unmount } = render(<TradeVerdict assessment={EVEN} />);
    expect(screen.getByText(/close to even/i)).toBeVisible();
    unmount();
  });

  it("says who a lopsided trade favors, from the viewer's own giving/receiving frame", () => {
    const first = render(<TradeVerdict assessment={FAVORS_PROPOSER} />);
    expect(screen.getByText(/favors what you would get back/i)).toBeVisible();
    first.unmount();

    render(<TradeVerdict assessment={FAVORS_RECEIVER} />);
    expect(screen.getByText(/favors what you would give up/i)).toBeVisible();
  });

  it("shows both sides' weekly value, rounded the same way the rest of the room rounds points", () => {
    render(<TradeVerdict assessment={LOPSIDED} />);
    expect(screen.getByText("42.50 points a week going out, 12.00 points a week coming back.")).toBeVisible();
  });

  it("carries no em dash or en dash", () => {
    render(<TradeVerdict assessment={LOPSIDED} />);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });
});
