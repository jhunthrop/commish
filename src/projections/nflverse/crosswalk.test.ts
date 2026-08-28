import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { buildCrosswalk, type CrosswalkPlayer } from "./crosswalk";

const player = (id: string, name: string, position: Position, nflTeam: string): CrosswalkPlayer => ({
  id,
  name,
  position,
  nflTeam,
});

const ROSTER = [
  player("1", "Josh Allen", "QB", "BUF"),
  player("2", "James Cook", "RB", "BUF"),
  player("3", "Khalil Shakir", "WR", "BUF"),
  player("4", "Dalton Kincaid", "TE", "BUF"),
  player("5", "Marvin Harrison Jr.", "WR", "ARI"),
  // Two men, one name, two teams — the case a name-only match must not guess at.
  player("6", "Mike Williams", "WR", "NYJ"),
  player("7", "Mike Williams", "WR", "PIT"),
];

describe("buildCrosswalk", () => {
  const crosswalk = buildCrosswalk(ROSTER);

  it("matches on name and position", () => {
    expect(crosswalk.resolve({ name: "Josh Allen", position: "QB", team: "BUF" })).toBe("1");
  });

  it("ignores punctuation, case and a generational suffix — feeds disagree about all three", () => {
    expect(crosswalk.resolve({ name: "MARVIN HARRISON JR", position: "WR", team: "ARI" })).toBe("5");
  });

  it("falls back to the name alone when the two feeds disagree about position", () => {
    // Taysom Hill is the standing example: a quarterback to one feed, a tight end to another.
    const drift = buildCrosswalk([player("9", "Taysom Hill", "QB", "NO")]);
    expect(drift.resolve({ name: "Taysom Hill", position: "TE", team: "NO" })).toBe("9");
  });

  it("breaks a same-name tie by team rather than picking one", () => {
    expect(crosswalk.resolve({ name: "Mike Williams", position: "WR", team: "PIT" })).toBe("7");
  });

  it("refuses to guess when two men share a name and neither is on the stated team", () => {
    expect(crosswalk.resolve({ name: "Mike Williams", position: "WR", team: "LAC" })).toBeNull();
  });

  it("answers null for someone we simply do not carry", () => {
    expect(crosswalk.resolve({ name: "Nobody At All", position: "WR", team: "BUF" })).toBeNull();
  });
});

describe("resolveAll — an unmatched player is REPORTED, never dropped", () => {
  it("splits its input into resolved ids and a named unresolved list", () => {
    const crosswalk = buildCrosswalk(ROSTER);
    const result = crosswalk.resolveAll([
      { name: "Josh Allen", position: "QB", team: "BUF" },
      { name: "James Cook", position: "RB", team: "BUF" },
      { name: "Nobody At All", position: "WR", team: "BUF" },
      { name: "Mike Williams", position: "WR", team: "LAC" },
    ]);

    expect(result.resolved.size).toBe(2);
    expect(result.unresolved).toEqual([
      { name: "Nobody At All", position: "WR", team: "BUF", reason: "absent", occurrences: 1 },
      { name: "Mike Williams", position: "WR", team: "LAC", reason: "ambiguous", occurrences: 1 },
    ]);
  });

  it("counts a repeated unresolved player once, with its occurrence count", () => {
    const crosswalk = buildCrosswalk(ROSTER);
    const candidate = { name: "Nobody At All", position: "WR" as const, team: "BUF" };
    const result = crosswalk.resolveAll([candidate, candidate, candidate]);
    expect(result.unresolved).toEqual([{ ...candidate, reason: "absent", occurrences: 3 }]);
  });

  it("reports the resolution rate, because a bad join looks exactly like players who did not play", () => {
    const crosswalk = buildCrosswalk(ROSTER);
    const result = crosswalk.resolveAll([
      { name: "Josh Allen", position: "QB", team: "BUF" },
      { name: "James Cook", position: "RB", team: "BUF" },
      { name: "Khalil Shakir", position: "WR", team: "BUF" },
      { name: "Nobody At All", position: "WR", team: "BUF" },
    ]);
    expect(result.resolutionRate).toBe(0.75);
  });

  it("has no rate to report on an empty input, rather than claiming a perfect one", () => {
    expect(buildCrosswalk(ROSTER).resolveAll([]).resolutionRate).toBeNull();
  });
});
