import { describe, it, expect } from "vitest";
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
    const key: TermKey = "snake-draft";
    expect(term(key)).toBe(GLOSSARY[key]);
    expect(term("ppr").term).toBe("PPR");
  });
});
