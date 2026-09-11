import { describe, it, expect } from "vitest";
import { sundaySentence, type SundayInput } from "./sunday-sentence";

const BASE: SundayInput = {
  myScore: 88.4,
  theirScore: 99.8,
  myRemaining: 2,
  theirRemaining: 0,
  theirManager: "Rachel",
  myBestLeftName: "Cam Skattebo",
};

describe("sundaySentence", () => {
  // H3: the catching claim is arithmetic only when the opponent has finished.
  it("claims a catch only when the opponent has nobody left to play", () => {
    expect(sundaySentence(BASE)).toBe("You need 11.40 from Skattebo to catch Rachel.");
  });

  it("states the gap and the opponent's remaining count, with no claim of sufficiency, while they are still playing", () => {
    const said = sundaySentence({ ...BASE, theirRemaining: 4 });
    expect(said).toBe("Rachel leads by 11.40, with 4 of theirs still to play.");
    // The whole point: no "you need", because 11.40 catches nobody who is still scoring.
    expect(said).not.toMatch(/need/);
  });

  it("states your own lead and your own remaining count", () => {
    expect(sundaySentence({ ...BASE, myScore: 99.8, theirScore: 88.4, myRemaining: 2, theirRemaining: 1 })).toBe(
      "You lead by 11.40, with 2 of yours still to play.",
    );
  });

  // H2: a level matchup used to fall through the "ahead" branch and print "needs 0.00".
  it("never says a number is needed when the two sides are level", () => {
    const said = sundaySentence({ ...BASE, myScore: 90, theirScore: 90, myRemaining: 3, theirRemaining: 4 });
    expect(said).toBe("Level with Rachel, 3 of yours and 4 of theirs still to play.");
    expect(said).not.toMatch(/0\.00/);
    expect(said).not.toMatch(/needs/);
  });

  it("says nothing about a tie that has already finished", () => {
    expect(sundaySentence({ ...BASE, myScore: 90, theirScore: 90, myRemaining: 0, theirRemaining: 0 })).toBeNull();
  });

  it("says nothing when a week has not scored, or when the fixture is decided", () => {
    expect(sundaySentence({ ...BASE, myScore: null })).toBeNull();
    expect(sundaySentence({ ...BASE, theirScore: null })).toBeNull();
    // Behind with nobody left anywhere: there is no catching to describe.
    expect(sundaySentence({ ...BASE, myRemaining: 0, myBestLeftName: null })).toBeNull();
    // Ahead with nobody left anywhere: the same.
    expect(sundaySentence({ ...BASE, myScore: 99.8, theirScore: 88.4, myRemaining: 0, theirRemaining: 0 })).toBeNull();
  });

  it("falls back to the opponent's own remaining count when you are ahead and done", () => {
    expect(sundaySentence({ ...BASE, myScore: 99.8, theirScore: 88.4, myRemaining: 0, theirRemaining: 3 })).toBe(
      "You lead by 11.40, with 3 of theirs still to play.",
    );
  });

  it("says a surname, the way the room says it", () => {
    expect(sundaySentence({ ...BASE, myBestLeftName: "Tyrone Tracy Jr." })).toMatch(/from Jr\.|from Tracy/);
  });
});
