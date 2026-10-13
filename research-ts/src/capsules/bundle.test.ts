import { describe, expect, it } from "vitest";
import { parseBundle } from "./bundle";

/**
 * THE ONE-CALL BUNDLE (refrains round, 2026-09-07) — one JSON object carrying the compact read,
 * the full read and the narrative slots. The parser is the seam a live model's habits hit first:
 * a code fence, a sentence before the object, a raw line break inside a string, a missing part.
 */
describe("parseBundle", () => {
  it("reads the three parts out of a clean object", () => {
    const bundle = parseBundle(JSON.stringify({ compact: "Short.", full: "Long.", narrative: { call: "The call." } }));
    expect(bundle).toEqual({ compact: "Short.", full: "Long.", narrative: { call: "The call." } });
  });

  it("reads through a code fence and a sentence wrapped around the object", () => {
    const wrapped = "Here you go:\n```json\n" + JSON.stringify({ compact: "Short.", full: "Long.", narrative: {} }) + "\n```\nHope that helps.";
    expect(parseBundle(wrapped)?.compact).toBe("Short.");
  });

  it("repairs a raw line break inside a string, which a model writing paragraphs produces", () => {
    const raw = '{"compact": "Short.", "full": "First paragraph.\n\nSecond paragraph.", "narrative": {"call": "Tab\there."}}';
    const bundle = parseBundle(raw);
    expect(bundle?.full).toBe("First paragraph.\n\nSecond paragraph.");
    expect(bundle?.narrative).toEqual({ call: "Tab\there." });
  });

  it("reads a missing, empty or non-string part as null rather than as prose", () => {
    expect(parseBundle(JSON.stringify({ compact: "   ", narrative: { call: "x" } }))).toEqual({ compact: null, full: null, narrative: { call: "x" } });
    expect(parseBundle(JSON.stringify({ compact: 12, full: ["a"], narrative: "not an object" }))).toEqual({ compact: null, full: null, narrative: null });
    expect(parseBundle(JSON.stringify({ compact: "a", full: "b", narrative: ["a list"] }))?.narrative).toBeNull();
  });

  it("trims the parts it does read", () => {
    expect(parseBundle(JSON.stringify({ compact: "  Short.  ", full: "\nLong.\n", narrative: {} }))).toMatchObject({ compact: "Short.", full: "Long." });
  });

  it("returns null for anything that is not a JSON object at all", () => {
    expect(parseBundle("I cannot write that for you today.")).toBeNull();
    expect(parseBundle('["a", "list"]')).toBeNull();
    expect(parseBundle("{ this is not json }")).toBeNull();
    expect(parseBundle("")).toBeNull();
  });
});
