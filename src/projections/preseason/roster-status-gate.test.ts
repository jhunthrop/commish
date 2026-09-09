import { describe, expect, it } from "vitest";
import type { GamesPlayedOutlook } from "./availability";
import type { BoardCandidate } from "./board";
import { capGamesOutlook, gateCandidates, MINIMUM_ABSENCE_GAMES } from "./roster-status-gate";
import type { CurrentRosterStatus } from "./roster-status";

const OBSERVED = new Date("2026-09-05T22:35:00.000Z");

/** A games outlook with all its mass on three counts, so every number below is checkable by hand. */
function outlook(): GamesPlayedOutlook {
  const probabilities = Array.from({ length: 18 }, () => 0);
  probabilities[10] = 0.2;
  probabilities[15] = 0.5;
  probabilities[17] = 0.3;
  return { expected: 14.6, rate: 14.6 / 17, distribution: { floor: 10, median: 15, ceiling: 17 }, probabilities };
}

function candidate(playerId: string, overrides: Partial<BoardCandidate> = {}): BoardCandidate {
  return {
    playerId,
    position: "RB",
    team: "KC",
    perGame: { playerId, week: 1 } as BoardCandidate["perGame"],
    games: outlook(),
    reasons: [{ code: "availability", expectedGames: 14.6, floorGames: 10, ceilingGames: 17 }],
    ...overrides,
  };
}

function status(kind: CurrentRosterStatus["kind"], team: string | null = "KC"): CurrentRosterStatus {
  return { kind, source: "tank01_player_list", observedAt: OBSERVED, team };
}

describe("capGamesOutlook", () => {
  it("moves every count above the cap onto the cap and recomputes the mean from the moved mass", () => {
    const capped = capGamesOutlook(outlook(), 13);
    expect(capped.probabilities[13]).toBeCloseTo(0.8, 12);
    expect(capped.probabilities[15]).toBe(0);
    expect(capped.probabilities[17]).toBe(0);
    expect(capped.probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
    expect(capped.expected).toBeCloseTo(0.2 * 10 + 0.8 * 13, 12);
    expect(capped.rate).toBeCloseTo(capped.expected / 17, 12);
    expect(capped.distribution).toEqual({ floor: 10, median: 13, ceiling: 13 });
  });

  it("never lowers an outlook already under the cap", () => {
    const low: GamesPlayedOutlook = { ...outlook(), expected: 3, distribution: { floor: 0, median: 3, ceiling: 8 }, probabilities: [0.5, 0, 0, 0.5] };
    expect(capGamesOutlook(low, 13)).toBe(low);
  });

  it("never caps below the model's own floor", () => {
    const capped = capGamesOutlook(outlook(), 8);
    expect(capped.distribution.floor).toBe(10);
    expect(capped.expected).toBeCloseTo(10, 12);
  });
});

describe("gateCandidates", () => {
  it("caps a reserve-list player at the season less the minimum absence and says why on the row", () => {
    const { candidates, exclusions } = gateCandidates([candidate("ir")], new Map([["ir", status("injured_reserve")]]), 2026);
    expect(exclusions).toEqual([]);
    const [row] = candidates;
    expect(row?.games.expected).toBeCloseTo(0.2 * 10 + 0.8 * (17 - MINIMUM_ABSENCE_GAMES), 12);
    expect(row?.reasons).toEqual([
      { code: "availability", expectedGames: row!.games.expected, floorGames: 10, ceilingGames: 13 },
      { code: "roster_status", status: "injured_reserve", source: "tank01_player_list", observedAt: OBSERVED.toISOString(), team: "KC" },
    ]);
  });

  it("removes a practice-squad or unsigned player from the candidates and lists him with his status", () => {
    const statuses = new Map([
      ["ps", status("practice_squad", "NO")],
      ["fa", status("no_roster", null)],
      ["off", status("off_active_roster", "LAR")],
    ]);
    const { candidates, exclusions } = gateCandidates([candidate("ps"), candidate("fa"), candidate("off"), candidate("kept")], statuses, 2026);
    expect(candidates.map((row) => row.playerId)).toEqual(["kept"]);
    expect(exclusions).toEqual([
      { playerId: "ps", position: "RB", team: "KC", status: statuses.get("ps") },
      { playerId: "fa", position: "RB", team: "KC", status: statuses.get("fa") },
      { playerId: "off", position: "RB", team: "KC", status: statuses.get("off") },
    ]);
  });

  it("leaves an active or unknown player untouched, reasons included", () => {
    const active = candidate("active");
    const unknown = candidate("unknown");
    const { candidates } = gateCandidates([active, unknown], new Map([["active", status("active")]]), 2026);
    expect(candidates).toEqual([active, unknown]);
  });
});
