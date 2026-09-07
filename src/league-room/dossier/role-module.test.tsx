import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PlayerFactsTrend, PlayerFactsUsage } from "@/capsules/facts";
import type { DefenseSeasonFacts, KdefSeasonLine, KickerSeasonFacts } from "@/projections/kdef/season-lines";
import { RoleModule } from "./role-module";

const USAGE: PlayerFactsUsage = {
  season: 2025,
  snapShare: 0.62,
  snapShareRank: { value: 0.62, positionRank: 4, qualifierCount: 32, namedNeighbor: null },
  targetShare: null,
  targetShareRank: null,
  redZoneShare: 0.4,
  redZoneShareRank: { value: 0.4, positionRank: 2, qualifierCount: 32, namedNeighbor: "Someone Else" },
};

const MATERIAL_DECLINE: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 18.1, recentSeason: 2025, recentValue: 14.3, delta: -3.8, material: true },
  yardsPerOpportunity: null,
  targetShare: null,
};

const MATERIAL_RISE: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 10, recentSeason: 2025, recentValue: 15, delta: 5, material: true },
  yardsPerOpportunity: null,
  targetShare: null,
};

const NON_MATERIAL: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 12, recentSeason: 2025, recentValue: 12.4, delta: 0.4, material: false },
  yardsPerOpportunity: null,
  targetShare: null,
};

/** The season line's own shell — `weeks` is empty because this module never reads it. */
const LINE = { playerId: "k1", position: "K", season: 2025, weeks: [], points: 148.5, games: 16, pointsPerGame: 9.3, weeksMissingPointsAllowed: 0 } as const;

const KICKER_FACTS: KickerSeasonFacts = {
  kind: "K",
  fieldGoalsMade: 24,
  fieldGoalsAttempted: 28,
  extraPointsMade: 38,
  extraPointsAttempted: 40,
  distanceBands: [
    { label: "0 to 39", made: 12, attempted: 12 },
    { label: "40 to 49", made: 7, attempted: 9 },
    { label: "50 or more", made: 5, attempted: 7 },
  ],
  longestMadeBand: "50 or more",
};

const DEFENSE_FACTS: DefenseSeasonFacts = {
  kind: "DEF",
  sacks: 46.4,
  interceptions: 14,
  fumbleRecoveries: 10,
  takeaways: 24,
  defensiveTouchdowns: 3,
  specialTeamsTouchdowns: 1,
  safeties: 1,
  yardsAllowed: 4960,
  gamesWithYardsAllowed: 16,
  pointsAllowed: 296,
  gamesWithPointsAllowed: 16,
  pointsAllowedBandGames: [
    { label: "0", games: 1 },
    { label: "1 to 6", games: 3 },
    { label: "18 to 27", games: 12 },
  ],
};

function kickerLine(facts: Partial<KickerSeasonFacts> = {}): KdefSeasonLine {
  return { ...LINE, position: "K", facts: { ...KICKER_FACTS, ...facts } };
}

function defenseLine(overrides: Partial<KdefSeasonLine> = {}): KdefSeasonLine {
  return { ...LINE, playerId: "DST-BAL", position: "DEF", facts: DEFENSE_FACTS, ...overrides };
}

describe("RoleModule", () => {
  it("states each share as a percent and a position rank with its qualifier count", () => {
    const { container } = render(<RoleModule position="RB" usage={USAGE} trend={null} />);
    expect(container.textContent).toContain("62% · RB4 of 32");
    expect(container.textContent).toContain("40% · RB2 of 32");
  });

  it("prints an honest 'not tracked for him' for a share the store never carried", () => {
    const { container } = render(<RoleModule position="RB" usage={USAGE} trend={null} />);
    const targetRow = container.querySelector('[data-role-share="target"]')!;
    expect(targetRow.textContent).toContain("not tracked for him");
  });

  it("treats a wholly absent usage season the same as every share being untracked", () => {
    const { container } = render(<RoleModule position="RB" usage={null} trend={null} />);
    expect(container.querySelectorAll('[data-role-share]')).toHaveLength(3);
    for (const row of container.querySelectorAll('[data-role-share]')) {
      expect(row.textContent).toContain("not tracked for him");
    }
  });

  it("renders the trend sentence only when the year-over-year points-per-game trend is material", () => {
    const material = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />);
    expect(material.container.textContent).toContain("18.1 a game in 2024 fell to 14.3 in 2025,");
    expect(material.container.textContent).toContain("down 3.8");
    expect(material.container.textContent).toContain("A real move, not noise.");

    const nonMaterial = render(<RoleModule position="WR" usage={USAGE} trend={NON_MATERIAL} />);
    expect(nonMaterial.container.querySelector('[data-role="trend"]')).toBeNull();

    const absent = render(<RoleModule position="WR" usage={USAGE} trend={null} />);
    expect(absent.container.querySelector('[data-role="trend"]')).toBeNull();
  });

  it("colors the trend delta in the magnitude channel, weak for a decline and good for a rise", () => {
    const decline = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />);
    const declineStat = decline.container.querySelector('[data-magnitude]');
    expect(declineStat).toHaveAttribute("data-magnitude", "weak");

    const rise = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_RISE} />);
    const riseStat = rise.container.querySelector('[data-magnitude]');
    expect(riseStat).toHaveAttribute("data-magnitude", "good");
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

/**
 * THE TWO POSITIONS WITH NO OFFENSIVE ROLE (the 2026-09-06 round). Snap, target and red-zone share
 * are questions about an offense, and a kicker and a team defense are not on one. The module states
 * what each of them is actually judged on instead, out of the archive that holds it.
 */
describe("RoleModule, a kicker and a team defense", () => {
  it("states a kicker's makes of attempts, banded by distance, with the make rate", () => {
    const { container } = render(<RoleModule position="K" usage={null} trend={null} kdef={kickerLine()} />);
    expect(container.textContent).toContain("24 of 28 · 86%");
    expect(container.textContent).toContain("12 of 12 · 100%");
    expect(container.textContent).toContain("7 of 9 · 78%");
    expect(container.textContent).toContain("5 of 7 · 71%");
    expect(container.textContent).toContain("38 of 40 · 95%");
    expect(container.textContent).toContain("50 or more yards");
    // The share bars are gone entirely, rather than printing three "not tracked for him" rows.
    expect(container.querySelector("[data-role-share]")).toBeNull();
  });

  it("says he made none rather than naming a longest band he never reached", () => {
    const line = kickerLine({
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 2,
      distanceBands: [
        { label: "0 to 39", made: 0, attempted: 1 },
        { label: "40 to 49", made: 0, attempted: 1 },
        { label: "50 or more", made: 0, attempted: 0 },
      ],
      longestMadeBand: null,
    });
    const { container } = render(<RoleModule position="K" usage={null} trend={null} kdef={line} />);
    expect(container.textContent).toContain("he made none");
    // A band with no attempts states the count and no rate: a rate over nothing is not 0%.
    expect(container.textContent).toContain("0 of 0");
  });

  it("states a team defense per game, with the points-allowed bracket mix", () => {
    const { container } = render(<RoleModule position="DEF" usage={null} trend={null} kdef={defenseLine()} />);
    expect(container.textContent).toContain("Sacks a game");
    expect(container.textContent).toContain("2.9");
    expect(container.textContent).toContain("Takeaways a game");
    expect(container.textContent).toContain("1.5");
    expect(container.textContent).toContain("Defensive touchdowns");
    expect(container.textContent).toContain("Yards allowed a game");
    expect(container.textContent).toContain("310");
    expect(container.textContent).toContain("over 16 games");
    expect(container.querySelector('[data-role="points-allowed-bands"]')?.textContent).toContain("1 to 6 in 3");
  });

  it("says how many of these games have no final score, rather than averaging them in as zero", () => {
    const { container } = render(<RoleModule position="DEF" usage={null} trend={null} kdef={defenseLine({ weeksMissingPointsAllowed: 1 })} />);
    expect(container.querySelector('[data-role="points-allowed-gap"]')?.textContent).toContain("1 of these games have no final score on record");
  });

  it("says plainly that points allowed was never recorded, rather than printing a zero", () => {
    const facts = { ...DEFENSE_FACTS, pointsAllowed: null, gamesWithPointsAllowed: 0, pointsAllowedBandGames: [] };
    const { container } = render(<RoleModule position="DEF" usage={null} trend={null} kdef={{ ...LINE, position: "DEF", facts }} />);
    expect(container.textContent).toContain("not recorded for any of these games");
    expect(container.querySelector('[data-role="points-allowed-bands"]')).toBeNull();
  });

  it("follows the copy rules on both variants — no em-dash, no semicolon", () => {
    const kicker = render(<RoleModule position="K" usage={null} trend={null} kdef={kickerLine()} />);
    expect(kicker.container.textContent).not.toMatch(/[—;]/);
    const defense = render(<RoleModule position="DEF" usage={null} trend={null} kdef={defenseLine({ weeksMissingPointsAllowed: 2 })} />);
    expect(defense.container.textContent).not.toMatch(/[—;]/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<RoleModule position="DEF" usage={null} trend={null} kdef={defenseLine()} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
