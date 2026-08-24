import { describe, it, expect } from "vitest";
import { copyViolations } from "@/integrity/copy-rules";
import { SEAT_HOLD, SEAT_HOLD_REFUSALS } from "./seat-hold";

describe("SEAT_HOLD", () => {
  it("holds a seat for ten minutes", () => {
    expect(SEAT_HOLD.minutes).toBe(10);
  });
});

describe("SEAT_HOLD_REFUSALS copy sweep", () => {
  it("breaks none of the product's copy rules — no em/en dash, nothing accusatory or passive", () => {
    for (const sentence of Object.values(SEAT_HOLD_REFUSALS)) {
      expect(copyViolations(sentence)).toEqual([]);
    }
  });

  it("names every refusal with a real, non-empty, distinct sentence", () => {
    const sentences = Object.values(SEAT_HOLD_REFUSALS);
    expect(sentences.every((sentence) => sentence.length > 0)).toBe(true);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  // `SeatTakenPanel` (`@/league-room/components/seat-taken-panel`) renders this SAME sentence as
  // its own description, never a second phrasing of the same loss.
  it("says nothing is charged, on the exact promise the cosmetic-stakes rule makes", () => {
    expect(SEAT_HOLD_REFUSALS.taken.toLowerCase()).toContain("nothing was charged");
  });
});
