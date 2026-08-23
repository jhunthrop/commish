import { describe, expect, it } from "vitest";
import { copyViolations } from "@/integrity/copy-rules";
import { EXPERIENCE_TIER_LABEL, LEAGUE_EXPERIENCE_TIER_HINT, LEAGUE_EXPERIENCE_TIER_LABEL } from "./config";

/**
 * This directory ships user-facing copy as plain `.ts` exports, which is the same blind spot
 * `src/participation` had before `participation-copy.source.test.ts` closed it: the JSX sweep
 * (`room-copy.source.test.ts`) walks `.tsx` under the room directories, and a constant IMPORTED
 * into one of those files is not declared in one. Swept here, at the declaration.
 *
 * Not a directory-derived scan, deliberately: `src/identity` is mostly predicates and avatar
 * refs, and the two label maps below plus the one hint are the whole of its user-facing copy. A
 * named list that a reviewer can check against the file beats a walker over a directory with
 * three sentences in it.
 */
describe("src/identity writes its user-facing copy in the house voice", () => {
  const copy = [
    ...Object.values(EXPERIENCE_TIER_LABEL),
    ...Object.values(LEAGUE_EXPERIENCE_TIER_LABEL),
    LEAGUE_EXPERIENCE_TIER_HINT,
  ];

  it("finds copy to sweep, so an empty list can never pass silently", () => {
    expect(copy.length).toBeGreaterThanOrEqual(5);
    for (const text of copy) expect(text.length).toBeGreaterThan(0);
  });

  it.each(copy)("%s breaks no copy rule", (text) => {
    expect(copyViolations(text)).toEqual([]);
  });
});

/**
 * FINAL REVIEW ROUND 2, R2. The league-facing map is a SECOND map on purpose, and these are the
 * two properties that make it worth having rather than a duplicate of the account-facing one.
 */
describe("LEAGUE_EXPERIENCE_TIER_LABEL", () => {
  it("covers the same two tiers as the account-facing map, and says something different about each", () => {
    expect(Object.keys(LEAGUE_EXPERIENCE_TIER_LABEL).sort()).toEqual(Object.keys(EXPERIENCE_TIER_LABEL).sort());
    // A league is not "Played before" — it is open to people or reserved for some of them. If
    // these two maps ever agreed word for word, one of them would be describing the wrong subject.
    for (const tier of Object.keys(LEAGUE_EXPERIENCE_TIER_LABEL)) {
      expect(LEAGUE_EXPERIENCE_TIER_LABEL[tier]).not.toBe(EXPERIENCE_TIER_LABEL[tier]);
    }
  });

  it("puts the choice that refuses nobody FIRST, which is what makes it the create form's default", () => {
    // `CreateLeagueForm` builds its options with `Object.entries`, so this order IS the control's
    // order and its first entry IS the default. `experienced` is the only choice the creation gate
    // (`tierJoinPrecondition`, `@/league-service/enforcement`) never refuses, so a commissioner who
    // touches nothing can always create their league.
    expect(Object.keys(LEAGUE_EXPERIENCE_TIER_LABEL)[0]).toBe("experienced");
  });
});
