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

describe("the surname fallback — one man, two given names", () => {
  const roster = [
    player("1", "Joshua Palmer", "WR", "BUF"),
    player("2", "Kenny Gainwell", "RB", "TB"),
    player("3", "Chig Okonkwo", "TE", "WSH"),
    // Two receivers, same surname, same initial — the case the fallback must refuse.
    player("4", "Mike Evans", "WR", "TB"),
    player("5", "Miles Evans", "WR", "NYJ"),
  ];
  const crosswalk = buildCrosswalk(roster);

  it("matches a short given name to its long one, and back", () => {
    expect(crosswalk.resolve({ name: "Josh Palmer", position: "WR", team: "LAC" })).toBe("1");
    expect(crosswalk.resolve({ name: "Kenneth Gainwell", position: "RB", team: "PHI" })).toBe("2");
    expect(crosswalk.resolve({ name: "Chigoziem Okonkwo", position: "TE", team: "TEN" })).toBe("3");
  });

  it("refuses a true nickname, which shares no initial and would be a guess", () => {
    const nicknamed = buildCrosswalk([player("9", "Hollywood Brown", "WR", "PHI")]);
    expect(nicknamed.resolve({ name: "Marquise Brown", position: "WR", team: "ARI" })).toBeNull();
  });

  it("still refuses two men it cannot tell apart by team", () => {
    expect(crosswalk.resolve({ name: "M Evans", position: "WR", team: "LAR" })).toBeNull();
  });

  it("breaks that tie when the team does separate them", () => {
    expect(crosswalk.resolve({ name: "M Evans", position: "WR", team: "NYJ" })).toBe("5");
  });

  it("never reaches the fallback when a full name already matched", () => {
    // `Mike Evans` matches exactly; the fallback would have found two candidates and refused.
    expect(crosswalk.resolve({ name: "Mike Evans", position: "WR", team: "TB" })).toBe("4");
  });
});

describe("the collision guard — two people may not become one player", () => {
  it("refuses both when a looser rule marries two different men to one roster entry", () => {
    // Only `Mike Evans` is on the roster. Both `M Evans` and `Marcus Evans` reach him by surname
    // and initial, from different teams — so neither is safe, and picking one would write a whole
    // season of somebody else's snaps onto him.
    const crosswalk = buildCrosswalk([player("1", "Mike Evans", "WR", "TB")]);
    const result = crosswalk.resolveAll([
      { name: "M Evans", position: "WR", team: "TB" },
      { name: "Marcus Evans", position: "WR", team: "NYJ" },
    ]);

    expect(result.resolved.size).toBe(0);
    expect(result.unresolved.map((row) => row.reason)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("lets the strictest rule win when only the loose one collides", () => {
    const crosswalk = buildCrosswalk([player("1", "Mike Evans", "WR", "TB")]);
    const result = crosswalk.resolveAll([
      { name: "Mike Evans", position: "WR", team: "TB" },
      { name: "Marcus Evans", position: "WR", team: "NYJ" },
    ]);

    expect([...result.resolved.values()]).toEqual(["1"]);
    expect(result.unresolved).toEqual([
      { name: "Marcus Evans", position: "WR", team: "NYJ", reason: "ambiguous", occurrences: 1 },
    ]);
  });

  it("still lets ONE man arrive under several identities — a midseason trade changes his team", () => {
    const crosswalk = buildCrosswalk([player("1", "Amari Cooper", "WR", "BUF")]);
    const result = crosswalk.resolveAll([
      { name: "Amari Cooper", position: "WR", team: "CLE" },
      { name: "Amari Cooper", position: "WR", team: "BUF" },
    ]);

    expect(result.resolved.size).toBe(2);
    expect(result.unresolved).toEqual([]);
  });
});
