import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Scoreboard, type SideProps } from "./scoreboard";

const HOME: SideProps = {
  name: "Bay Bandits",
  record: "7-3",
  score: "118.4",
  projected: "131.2",
  crest: <span data-testid="home-crest">BB</span>,
  winning: true,
};

const AWAY: SideProps = {
  name: "Tuna Sharks",
  record: "5-5",
  score: "104.9",
  projected: "126.7",
  crest: <span data-testid="away-crest">TS</span>,
  winning: false,
};

describe("Scoreboard", () => {
  it("puts both teams' identity, score and projected final on the screen", async () => {
    await renderSurface(<Scoreboard home={HOME} away={AWAY} middle={<p>middle</p>} />, ({ getByText, getByTestId }) => {
      expect(getByText("Bay Bandits")).toBeInTheDocument();
      expect(getByText("7-3")).toBeInTheDocument();
      expect(getByText("118.4")).toBeInTheDocument();
      expect(getByText("131.2")).toBeInTheDocument();
      expect(getByTestId("home-crest")).toBeInTheDocument();
      expect(getByText("Tuna Sharks")).toBeInTheDocument();
      expect(getByText("104.9")).toBeInTheDocument();
      expect(getByTestId("away-crest")).toBeInTheDocument();
      expect(getByText("middle")).toBeInTheDocument();
    });
  });

  it("makes the score the largest thing on the screen, at the display scale's 84px step", async () => {
    // LAW 2: "A score is 84px; its label is 11px. If the largest thing on a screen is not a
    // number or a name, the screen is wrong." Nothing else in this component is allowed to grow
    // to meet it — the name is `text-lg` and the record is a micro-label.
    await renderSurface(<Scoreboard home={HOME} away={AWAY} middle={null} />, ({ getByText }) => {
      expect(getByText("118.4").parentElement!.className).toContain("text-display-2xl");
      expect(getByText("Bay Bandits").className).toContain("text-lg");
    });
  });

  it("keeps the score's own label visible, never borrowing the table-cell escape", async () => {
    // `srOnlyLabel` exists for one situation — a cell under its own `<th>`. An 84px figure with
    // no name on screen is precisely what `Stat` was built to stop shipping.
    await renderSurface(<Scoreboard home={HOME} away={AWAY} middle={null} />, ({ getAllByText }) => {
      for (const label of getAllByText("Score")) {
        expect(label.className).not.toContain("sr-only");
      }
    });
  });

  /**
   * THE HONEST-COMPARISON RULING, pinned so it cannot be quietly reversed to match the mock.
   *
   * The population a matchup hero has to hand is "the two teams in this matchup", which is a pair
   * rather than a population: the percentile inside it is fully determined by `winning` (1.0 or
   * 0.0), so a 0.2-point lead would paint in the same top-of-the-population ink as a sixty-point
   * blowout and announce "Top 1% of the two teams in this matchup" to a screen reader. So the
   * hero synthesizes nothing, and the lead is carried by channels that are actually true.
   */
  it("colours neither score by default, because a matchup of two is not a population", async () => {
    await renderSurface(<Scoreboard home={HOME} away={AWAY} middle={null} />, ({ container }) => {
      const steps = Array.from(container.querySelectorAll("[data-magnitude]")).map((n) => n.getAttribute("data-magnitude"));
      expect(steps).toEqual(["neutral", "neutral"]);
      // And no invented sentence about a population, either.
      expect(container.textContent).not.toContain("Top ");
      expect(container.textContent).not.toContain("Bottom ");
    });
  });

  it("marks the lead in words and in the DOM, so it survives a monochrome screen", async () => {
    await renderSurface(<Scoreboard home={HOME} away={AWAY} middle={null} />, ({ getByText, container }) => {
      expect(getByText("Leading")).toBeInTheDocument();
      const sides = Array.from(container.querySelectorAll("[data-winning]")).map((n) => n.getAttribute("data-winning"));
      expect(sides).toEqual(["true", "false"]);
    });
  });

  it("tints a score only when a caller brings a real population of its own", async () => {
    // The seam, exercised: a surface that genuinely knows where this score falls among every
    // team in the league this week passes that, and the tint means what it says.
    const comparison = { percentile: 0.92, population: "team scores in this league this week" };
    await renderSurface(<Scoreboard home={{ ...HOME, comparison }} away={AWAY} middle={null} />, ({ container, getByText }) => {
      const steps = Array.from(container.querySelectorAll("[data-magnitude]")).map((n) => n.getAttribute("data-magnitude"));
      expect(steps).toEqual(["strong", "neutral"]);
      expect(getByText("Top 8% of team scores in this league this week.")).toBeInTheDocument();
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<Scoreboard home={HOME} away={AWAY} middle={<p>middle</p>} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
