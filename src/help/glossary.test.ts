import { describe, it, expect } from "vitest";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { HELP_CONFIG } from "./config";
import { GLOSSARY, term, type TermKey } from "./glossary";

describe("GLOSSARY", () => {
  it("every term has a short line and a longer one, and no em-dash anywhere", () => {
    for (const entry of Object.values(GLOSSARY)) {
      expect(entry.short.length).toBeLessThanOrEqual(HELP_CONFIG.maxShortLength);
      expect(entry.detail).toMatch(/\S/);
      expect(`${entry.term}${entry.short}${entry.detail}`).not.toContain("—");
    }
  });

  it("keys every entry under its own key, so a lookup can never return a mislabeled term", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.key).toBe(key);
    }
  });

  it("does not define a waiver term — this product has no waiver-wire surface", () => {
    expect(Object.keys(GLOSSARY)).not.toContain("waiver");
  });

  it("term() looks up the exact entry a key names", () => {
    // `expect(term(key)).toBe(GLOSSARY[key])` used to lead this case: the constant compared to
    // itself through one indirection, green for any lookup that returns SOMETHING from the map.
    // These name the entry each key must resolve to.
    const key: TermKey = "snake-draft";
    expect(term(key).key).toBe("snake-draft");
    expect(term(key).term).toBe("a snake draft");
    expect(term("ppr").term).toBe("PPR");
    expect(term("on-the-clock").short).toMatch(/\S/);
    // Two different keys never resolve to one entry.
    expect(term("ppr")).not.toBe(term("half-ppr"));
  });

  // Task 1 (superflex): the word a first-timer needs to act on the new roster-shape select.
  it("defines superflex as a flex spot that also takes a quarterback", () => {
    expect(term("superflex").term).toBe("a superflex spot");
    expect(term("superflex").short).toContain("quarterback");
  });

  // Phase 3.5, Task 9: the word a commissioner needs to act on the create form's own draft-start
  // control. The number is computed from `MATCHMAKING_CONFIG.sitAndGo.graceSeconds` rather than
  // typed a second time here, so this assertion and the copy it checks can never drift apart.
  it("defines a sit-and-go league by the same grace period the fill trigger actually waits", () => {
    expect(term("sit-and-go").term).toBe("a sit-and-go league");
    expect(term("sit-and-go").short).toMatch(/moment every seat fills/);
    expect(term("sit-and-go").detail).toContain(`${MATCHMAKING_CONFIG.sitAndGo.graceSeconds / 60} minutes`);
  });
});
