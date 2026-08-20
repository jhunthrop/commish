import { describe, it, expect } from "vitest";
import { REMOVAL_REASON_VALUES, REVIEW_CONFIG, removalPhraseFor } from "./config";

describe("removal reason vocabulary", () => {
  it("offers exactly the closed report set as removal reasons, in one list", () => {
    expect(REMOVAL_REASON_VALUES).toEqual(["spam", "abusive", "other"]);
    expect(REMOVAL_REASON_VALUES).toEqual(REVIEW_CONFIG.reportReasons.map((reason) => reason.value));
  });

  it("reads as a sentence when the author is told why", () => {
    // The copy runs "Your review was removed for ___. It can't be edited." — a reporter's own
    // label ("Spam or fake") does not fit that slot, which is why there are two phrasings.
    for (const reason of REVIEW_CONFIG.reportReasons) {
      expect(`Your review was removed for ${removalPhraseFor(reason.value)}.`).toMatch(/^Your review was removed for [a-z].*\.$/);
    }
    expect(removalPhraseFor("spam")).toBe("spam or fake content");
    expect(removalPhraseFor("other")).toBe("breaking the review rules");
  });

  it("never prints an unrecognized stored reason back to the author", () => {
    // Rows written before the operator script constrained `--reason`, or by hand in SQL. An
    // operator's private wording must not reach a sentence on the author's own profile.
    expect(removalPhraseFor("internal note: see ticket 4821")).toBe("breaking the review rules");
    expect(removalPhraseFor("")).toBe("breaking the review rules");
  });
});
