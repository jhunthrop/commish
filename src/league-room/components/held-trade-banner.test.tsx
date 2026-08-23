import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { HeldTradeBanner } from "./held-trade-banner";

describe("HeldTradeBanner", () => {
  it("says the trade is waiting on a fairness review, naming the league and the counterparty, axe-clean in both themes", async () => {
    await renderSurface(<HeldTradeBanner leagueName="Sunday Money" counterpartyTeamName="Iron Owls" />, async ({ container }) => {
      expect(screen.getByText(/Your trade with Iron Owls in Sunday Money is on hold/)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never says 'under investigation' or 'suspicious' — founder decision #10, as shipped", () => {
    render(<HeldTradeBanner leagueName="Sunday Money" counterpartyTeamName="Iron Owls" />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("investigation");
    expect(text).not.toContain("suspicious");
    expect(text).toContain("somebody at Commish looks at it");
    expect(text).toContain("this lopsided");
  });
});
