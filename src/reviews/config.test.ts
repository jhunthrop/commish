import { describe, it, expect } from "vitest";
import { REMOVAL_REASON_VALUES, REVIEW_CONFIG, removalPhraseFor, removalSentenceFor } from "./config";

describe("removal reason vocabulary", () => {
  it("keeps the shipped vocabulary byte for byte after the move to @/moderation, because members have already read it", () => {
    // `src/moderation/removal.test.ts` owns the grep tripwire that makes a second literal list
    // impossible; this is the matching regression pin on THIS module's own re-exported shape.
    // `chatRemovalPhrase` (fix round 1) rides along on every entry now — reviews' own reading
    // (`removalPhraseFor`) never touches it, only chat's (`chatRemovalPhraseFor`) does.
    expect(REVIEW_CONFIG.reportReasons).toEqual([
      { value: "spam", label: "Spam or fake", removalPhrase: "spam or fake content", chatRemovalPhrase: "spam or fake content" },
      { value: "abusive", label: "Abusive or harassing", removalPhrase: "abusive or harassing content", chatRemovalPhrase: "abusive or harassing content" },
      { value: "other", label: "Something else", removalPhrase: "breaking the review rules", chatRemovalPhrase: "breaking the chat rules" },
    ]);
  });

  it("offers exactly the closed report set as removal reasons, in one list", () => {
    expect(REMOVAL_REASON_VALUES).toEqual(["spam", "abusive", "other"]);
    expect(REMOVAL_REASON_VALUES).toEqual(REVIEW_CONFIG.reportReasons.map((reason) => reason.value));
  });

  it("reads as a sentence when the author is told why", () => {
    // The copy runs "We removed your review for ___. It cannot be edited." — a reporter's own
    // label ("Spam or fake") does not fit that slot, which is why there are two phrasings.
    // `removalSentenceFor` is the ONE place that sentence exists: `ReviewComposer` renders it and
    // `scripts/remove-review.ts` previews it, and they had drifted into two literals that only
    // happened to agree.
    for (const reason of REVIEW_CONFIG.reportReasons) {
      expect(removalSentenceFor(reason.value)).toMatch(/^We removed your review for [a-z].*\. It cannot be edited\.$/);
      expect(removalSentenceFor(reason.value)).toContain(removalPhraseFor(reason.value));
    }
    expect(removalPhraseFor("spam")).toBe("spam or fake content");
    expect(removalPhraseFor("other")).toBe("breaking the review rules");
  });

  it("never prints an unrecognized stored reason back to the author", () => {
    // Rows written before the operator script constrained `--reason`, or by hand in SQL. An
    // operator's private wording must not reach a sentence on the author's own profile.
    expect(removalPhraseFor("internal note: see ticket 4821")).toBe("breaking the review rules");
    expect(removalPhraseFor("")).toBe("breaking the review rules");
    // And an ABSENT one, which is what `myReview` now reports for a row whose `removal_reason`
    // column is empty — the mapper owns that fallback so the contract can keep carrying a token.
    expect(removalPhraseFor(null)).toBe("breaking the review rules");
    expect(removalSentenceFor(null)).toBe("We removed your review for breaking the review rules. It cannot be edited.");
  });
});
