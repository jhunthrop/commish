import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { SeasonWeek } from "@/components/ui";
import type { PlayerFactsLastSeasonStory } from "@research-ts/capsules/facts";
import { SeasonStrip } from "./season-strip";

const STORY: PlayerFactsLastSeasonStory = {
  season: 2025,
  pointsRank: { value: 260, positionRank: 4, qualifierCount: 32, namedNeighbor: null },
  pointsPerGame: 18.1,
  gamesPlayed: 15,
  bestWeek: { week: 12, points: 34.6 },
  weeksAboveMedian: 9,
  touchesRank: null,
  receivingYardsRank: { value: 410, positionRank: 12, qualifierCount: 45, namedNeighbor: null },
};

const WEEKS: readonly SeasonWeek[] = Array.from({ length: 17 }, (_, index) => ({ week: index + 1, points: index === 3 ? null : 10 + index }));

describe("SeasonStrip", () => {
  it("states all five facts with their own bases", () => {
    const { container } = render(<SeasonStrip story={STORY} weeks={WEEKS} scoringLabel="PPR" />);
    expect(container.textContent).toContain("15");
    expect(container.textContent).toContain("4th");
    expect(container.textContent).toContain("of 32");
    expect(container.textContent).toContain("18.1 a game");
    expect(container.textContent).toContain("PPR");
    expect(container.textContent).toContain("34.6");
    expect(container.textContent).toContain("week 12");
    expect(container.textContent).toContain("410");
    expect(container.textContent).toContain("12th of 45");
  });

  it("draws the full season as bars via the same SeasonBars chart the peek already uses", () => {
    const { container } = render(<SeasonStrip story={STORY} weeks={WEEKS} scoringLabel="PPR" />);
    expect(container.querySelectorAll('[data-testid="season-week"]')).toHaveLength(17);
  });

  it("mounts the switcher slot only when the caller supplies one", () => {
    const withSwitcher = render(<SeasonStrip story={STORY} weeks={WEEKS} scoringLabel="PPR" switcher={<button type="button">2024</button>} />);
    expect(withSwitcher.container.textContent).toContain("2024");

    const without = render(<SeasonStrip story={STORY} weeks={WEEKS} scoringLabel="PPR" />);
    expect(without.container.querySelector("button")).toBeNull();
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<SeasonStrip story={STORY} weeks={WEEKS} scoringLabel="PPR" />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<SeasonStrip story={STORY} weeks={WEEKS} scoringLabel="PPR" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
