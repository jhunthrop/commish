import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    await renderSurface(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} helpLevel="standard" />, async ({ container, getByText }) => {
      expect(getByText("The house always has a game.")).toBeInTheDocument();
      expect(getByText("Open leagues")).toBeInTheDocument();
      // F17: seat counts come through `SeatMeter` (`OpenLeagueCard`'s own render), never a
      // fourth phrasing written here.
      expect(container.querySelectorAll('[data-testid="seat-segments"]').length).toBe(PUBLIC_LEAGUES.length);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders nothing at all when there are no open leagues", () => {
    const { container } = render(<OpenSeatsPanel leagues={[]} helpLevel="standard" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a quieter, smaller heading when quiet (Step 4's below-the-fold case)", () => {
    render(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} quiet helpLevel="standard" />);
    const heading = screen.getByRole("heading", { name: "Open leagues" });
    expect(heading.tagName).toBe("H3");
  });

  it("uses a full h2 by default", () => {
    render(<OpenSeatsPanel leagues={PUBLIC_LEAGUES} helpLevel="standard" />);
    const heading = screen.getByRole("heading", { name: "Open leagues" });
    expect(heading.tagName).toBe("H2");
  });
});
