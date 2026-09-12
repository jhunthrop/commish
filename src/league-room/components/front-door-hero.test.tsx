import { describe, it, expect } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { MONEY_STATES } from "@/money/states";
import { FrontDoorHero } from "./front-door-hero";

/** A live config a test may hold without editing shipped state — the `moneyGates` seam idiom. */
const LIVE_STATES = { enabled: [{ state: "TN" as const, minAge: 18 }], neverEligible: MONEY_STATES.neverEligible };

/**
 * Front door blueprint (2026-09-02): the hero is the headline, the sub and the derived money
 * fact — nothing that acts. These tests pin the shape and the two retirements (the verb row and
 * the practice link both moved: the featured ROW carries the page's one solid verb, the practice
 * invitation lives in the trust cards), so the old acting hero cannot silently grow back.
 */
describe("FrontDoorHero", () => {
  it("says the operator's one claim as the headline, in the display face at its earned weight", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByRole }) => {
      const heading = getByRole("heading", { level: 1, name: "There is always a seat." });
      expect(heading.className).toContain("font-display");
      expect(heading.className).toContain("font-extrabold");
      // E6 survives: the display size still takes the responsive step, so 360px never wears 58px type.
      expect(heading.className).toContain("text-display-md");
      expect(heading.className).toContain("sm:text-display-xl");
    });
  });

  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderSurface(<FrontDoorHero />, ({ getByText, queryByText }) => {
      expect(getByText("Every league is free this season.")).toBeInTheDocument();
      // Dark means dark: no eligibility line renders while no state is enabled (law 7).
      expect(queryByText(/Real money is open in/)).not.toBeInTheDocument();
    });
  });

  it("gives way to the live money sentence once a state is enabled, and never says both", async () => {
    await renderSurface(<FrontDoorHero live states={LIVE_STATES} />, ({ getByText, queryByText }) => {
      expect(getByText("Play free everywhere, or play for real money where your state allows.")).toBeInTheDocument();
      expect(queryByText("Every league is free this season.")).not.toBeInTheDocument();
    });
  });

  it("renders the state-eligibility line from the real money-states config, only when live", async () => {
    await renderSurface(<FrontDoorHero live states={LIVE_STATES} />, ({ getByText }) => {
      expect(getByText("Real money is open in 1 state · 18+ · state list under How it works")).toBeInTheDocument();
    });
  });

  it("carries nothing that acts — the board below is the landing, and the featured row owns the verb", async () => {
    await renderSurface(<FrontDoorHero />, ({ container, queryByText }) => {
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("button")).toBeNull();
      // The old explainer stack stays retired too.
      expect(queryByText(/A league is a group of managers/)).not.toBeInTheDocument();
      expect(queryByText(/Filling now/)).not.toBeInTheDocument();
      expect(queryByText(/No account is needed/)).not.toBeInTheDocument();
    });
  });

  it("stays axe-clean in both themes", async () => {
    await renderSurface(<FrontDoorHero live states={LIVE_STATES} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("the who-is-inside card's basis (fix round, SIDELINE 2026-09-10)", () => {
    it("says nothing, no card at all, when there are no open rooms to sum", async () => {
      await renderSurface(<FrontDoorHero inside={{ seatsTaken: 0, openRooms: 0 }} />, ({ queryByText }) => {
        expect(queryByText(/taken across/)).not.toBeInTheDocument();
      });
    });

    it("singularizes seat and pluralizes room independently — they are never the same count", async () => {
      await renderSurface(<FrontDoorHero inside={{ seatsTaken: 1, openRooms: 2 }} />, ({ getByText }) => {
        expect(getByText("seat taken across the 2 open rooms below")).toBeInTheDocument();
      });
    });

    it("pluralizes seats and singularizes room independently, the other way round", async () => {
      await renderSurface(<FrontDoorHero inside={{ seatsTaken: 4, openRooms: 1 }} />, ({ getByText }) => {
        expect(getByText("seats taken across the 1 open room below")).toBeInTheDocument();
      });
    });

    it("singularizes both when a single seat is taken in the one open room", async () => {
      await renderSurface(<FrontDoorHero inside={{ seatsTaken: 1, openRooms: 1 }} />, ({ getByText }) => {
        expect(getByText("seat taken across the 1 open room below")).toBeInTheDocument();
      });
    });
  });
});
