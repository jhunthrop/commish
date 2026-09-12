import { describe, expect, it } from "vitest";
import { STARTING_NOW } from "@/league-room/lib/home-card";
import { LEAGUE_VERB } from "@/league-room/lib/verbs";
import { COPY as NEXT_ACTION_COPY } from "./next-action";
import { relativeDraftTime } from "./terms";

/**
 * THE ONE SEAM THE CLIENT BOUNDARY FORCES OPEN. `NEXT_ACTION_COPY` owns the product's action
 * words (C2), and `src/league-room/**` may not value-import `@/league` (eslint's client-boundary
 * rule), so the signed-in home's card spells the one label it shares in `LEAGUE_VERB` instead of
 * importing it. This file lives OUTSIDE the room directory, where importing both is legal, and
 * exists only to make that duplication a checked one: change either spelling and this goes red in
 * the same run.
 */
describe("the room's verb copy does not drift from the product's own", () => {
  it("spells the open-lineup verb exactly as NEXT_ACTION_COPY does", () => {
    expect(LEAGUE_VERB.setLineup).toBe(NEXT_ACTION_COPY["set-lineup"]);
  });

  it("spells the starting-now verb exactly as NEXT_ACTION_COPY's join-draft does", () => {
    expect(LEAGUE_VERB.joinDraft).toBe(NEXT_ACTION_COPY["join-draft"]);
  });

  it("spells the starting-now signal exactly as relativeDraftTime's own zero branch does", () => {
    // The server puts this phrase on the wire (`HomeLeagueCard.kickoffRelative`) and the card
    // reads it to decide a full room's kickoff has come. Two spellings would silently disable
    // that branch and put a stale clock back on the card, which is the defect fix round 2 closes.
    expect(relativeDraftTime(1_000, 1_000)).toBe(STARTING_NOW);
    expect(relativeDraftTime(1_000, 5_000)).toBe(STARTING_NOW);
  });

  it("keeps the four pre-draft and idle verbs OUT of NEXT_ACTION_COPY, which never named them", () => {
    const owned = new Set(Object.values(NEXT_ACTION_COPY));
    for (const verb of [LEAGUE_VERB.rankSlots, LEAGUE_VERB.mockDraft, LEAGUE_VERB.previewRoom, LEAGUE_VERB.openRoom]) {
      expect(owned.has(verb)).toBe(false);
    }
  });
});
