import { describe, expect, it } from "vitest";
import { mapSearchResults } from "./map";

const VALID = {
  id: "abc123",
  title: "Touchdown Dance GIF",
  images: {
    original: { url: "https://media.giphy.com/media/abc123/giphy.gif", width: "480", height: "270" },
    fixed_height: { url: "https://media.giphy.com/media/abc123/200.gif", width: "356", height: "200" },
  },
};

describe("mapSearchResults", () => {
  it("maps id, both renditions, coerced dimensions and the title as alt text", () => {
    expect(mapSearchResults([VALID], "touchdown")).toEqual([
      {
        id: "abc123",
        url: "https://media.giphy.com/media/abc123/giphy.gif",
        previewUrl: "https://media.giphy.com/media/abc123/200.gif",
        width: 480,
        height: 270,
        alt: "Touchdown Dance GIF",
      },
    ]);
  });

  it("synthesizes alt text from the query when the title is blank", () => {
    const results = mapSearchResults([{ ...VALID, title: "" }], "touchdown");
    expect(results[0]?.alt).toBe('A GIF for "touchdown"');
  });

  it("synthesizes alt text when the title field is absent entirely", () => {
    const withoutTitle = { id: VALID.id, images: VALID.images };
    const results = mapSearchResults([withoutTitle], "touchdown");
    expect(results[0]?.alt).toBe('A GIF for "touchdown"');
  });

  it("drops an entry missing an id rather than emitting a broken result", () => {
    expect(mapSearchResults([{ ...VALID, id: "" }], "touchdown")).toEqual([]);
  });

  it("drops an entry missing the original rendition's url", () => {
    expect(
      mapSearchResults([{ ...VALID, images: { ...VALID.images, original: { width: "480", height: "270" } } }], "touchdown"),
    ).toEqual([]);
  });

  it("drops an entry missing the fixed_height (preview) rendition entirely", () => {
    const images = { original: VALID.images.original };
    expect(mapSearchResults([{ ...VALID, images }], "touchdown")).toEqual([]);
  });

  it("drops an entry whose dimensions are zero, missing or non-numeric", () => {
    expect(
      mapSearchResults(
        [{ ...VALID, images: { ...VALID.images, original: { ...VALID.images.original, width: "0" } } }],
        "touchdown",
      ),
    ).toEqual([]);
    expect(
      mapSearchResults(
        [{ ...VALID, images: { ...VALID.images, original: { ...VALID.images.original, width: "not-a-number" } } }],
        "touchdown",
      ),
    ).toEqual([]);
  });

  it("dedupes a repeated id within one response", () => {
    const results = mapSearchResults([VALID, { ...VALID, title: "A second copy" }], "touchdown");
    expect(results).toHaveLength(1);
    expect(results[0]?.alt).toBe("Touchdown Dance GIF");
  });

  it("returns an empty list for a body that is not an array, and drops a non-object entry", () => {
    expect(mapSearchResults({}, "touchdown")).toEqual([]);
    expect(mapSearchResults(null, "touchdown")).toEqual([]);
    expect(mapSearchResults([null, "not a gif", 42], "touchdown")).toEqual([]);
  });

  it("tolerates an entry with no images object at all", () => {
    const withoutImages = { id: VALID.id, title: VALID.title };
    expect(mapSearchResults([withoutImages], "touchdown")).toEqual([]);
  });
});
