import { describe, expect, it } from "vitest";
import { copyViolations } from "./copy-rules";
import { ROSTER_STATUS_KINDS, ROSTER_STATUS_SOURCES, type RosterStatusNote } from "@research/projections/preseason/roster-status";
import {
  NOT_ON_ACTIVE_ROSTER_BAND,
  NOT_ON_ACTIVE_ROSTER_NOTE,
  noProjectionSentence,
  observedOn,
  rosterStatusLabel,
  rosterStatusObservation,
  rosterStatusPhrase,
  rosterStatusSentence,
} from "@research/projections/preseason/roster-status-copy";

function note(overrides: Partial<RosterStatusNote> = {}): RosterStatusNote {
  return { status: "injured_reserve", source: "tank01_player_list", observedAt: "2026-09-05T22:35:00.000Z", team: "KC", excluded: false, ...overrides };
}

describe("roster status copy", () => {
  it("prints the observation date as a short month and day, in UTC", () => {
    expect(observedOn("2026-09-05T22:35:00.000Z")).toBe("Sep 5");
    expect(observedOn("2026-09-08T23:59:00.000Z")).toBe("Sep 8");
  });

  it("states the status, when it was observed and which source said so", () => {
    expect(rosterStatusSentence(note())).toBe("On injured reserve, observed Sep 5 on the player list");
    expect(rosterStatusSentence(note({ status: "practice_squad", source: "nflverse_roster_week_1", observedAt: "2026-09-01T00:00:00.000Z" }))).toBe(
      "Practice squad, observed Sep 1 on the week 1 roster",
    );
    expect(rosterStatusSentence(note({ status: "no_roster", team: null }))).toBe("Not on any roster, observed Sep 5 on the player list");
    expect(rosterStatusSentence(note({ status: "off_active_roster", team: "LAR" }))).toBe("Not on the active roster, observed Sep 5 on the player list");
  });

  it("splits the same words into a lead clause and an observation clause for a two-line surface", () => {
    expect(rosterStatusPhrase("injured_reserve")).toBe("On injured reserve");
    expect(rosterStatusObservation(note())).toBe("Observed Sep 5 on the player list");
    expect(noProjectionSentence(note({ status: "no_roster" }))).toBe(
      "Not on any roster, observed Sep 5 on the player list. He has no projection while he is off an active roster.",
    );
  });

  it("has a short pill label for every status", () => {
    expect(rosterStatusLabel("injured_reserve")).toBe("IR");
    expect(rosterStatusLabel("practice_squad")).toBe("Practice squad");
    for (const kind of ROSTER_STATUS_KINDS) expect(rosterStatusLabel(kind).length).toBeGreaterThan(0);
  });

  it("keeps every sentence inside the house copy rules", () => {
    const sentences = ROSTER_STATUS_KINDS.flatMap((status) => ROSTER_STATUS_SOURCES.map((source) => rosterStatusSentence(note({ status, source }))));
    for (const sentence of [...sentences, NOT_ON_ACTIVE_ROSTER_BAND, NOT_ON_ACTIVE_ROSTER_NOTE]) {
      expect(copyViolations(sentence)).toEqual([]);
    }
  });
});
