import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { PUBLIC_LEAGUES } from "../test-fixtures";
import { OpenSeatsPanel } from "./open-seats-panel";

// Every card renders signed-in (`OpenLeagueCard`'s `JoinPublicLeagueButton` branch), which calls
// `useRouter()` for its post-join `router.refresh()` — the same stub `open-league-card.test.tsx`
// and `join-public-league-button.test.tsx` use.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("OpenSeatsPanel", () => {
  it("renders the house's own promise and every league's seat count through SeatMeter, in both themes", async () => {
    await renderSurface(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} />, async ({ container, getByText }) => {
      expect(getByText("The house always has a game.")).toBeInTheDocument();
      expect(getByText("Open leagues")).toBeInTheDocument();
      // F17: seat counts come through `SeatMeter` (`LeagueRow`'s and `OpenLeagueCard`'s own
      // renders — both forms exist in the DOM at once, CSS gates which is visible), never a
      // fourth phrasing written here.
      expect(container.querySelectorAll('[data-testid="seat-segments"]').length).toBe(PUBLIC_LEAGUES.length * 2);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders the list twice — rows on lg+, cards below — with every action quiet (Task 12 adjudication)", () => {
    const { container } = render(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} />);
    // The founder's rows order ("horizontal row elements instead of these cards", 2026-08-24)
    // followed on the signed-in surface too — the same dual-render shape as `OpenLeagueShelf`
    // (Task 13), CSS deciding which form is visible at the lg boundary.
    const rows = screen.getByTestId("league-rows");
    const cards = screen.getByTestId("league-cards");
    expect(rows.className).toContain("hidden lg:block");
    expect(cards.className).toContain("lg:hidden");
    expect(within(rows).getAllByRole("button", { name: /^Join / })).toHaveLength(PUBLIC_LEAGUES.length);
    expect(within(cards).getAllByRole("button", { name: /^Join / })).toHaveLength(PUBLIC_LEAGUES.length);
    // Rule 5 + S10: on the home screen the one ink action belongs to the attention queue's top
    // item, so this panel never features a league — zero ink pills in either rendering.
    expect(container.querySelectorAll('[class*="bg-text-primary"]')).toHaveLength(0);
  });

  it("renders nothing at all when there are no open leagues", () => {
    const { container } = render(<OpenSeatsPanel leagues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a quieter, smaller heading when quiet (Step 4's below-the-fold case)", () => {
    render(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} quiet />);
    const heading = screen.getByRole("heading", { name: "Open leagues" });
    expect(heading.tagName).toBe("H3");
  });

  it("uses a full h2 by default", () => {
    render(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} />);
    const heading = screen.getByRole("heading", { name: "Open leagues" });
    expect(heading.tagName).toBe("H2");
  });
});
