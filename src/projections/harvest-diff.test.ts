import { describe, expect, it } from "vitest";
import { harvestDesignationDiff, harvestNewsDiff, injuryDesignationsIn, newsLinksIn } from "./harvest-diff";

function injuries(designations: Readonly<Record<string, string>>): { readonly payload: unknown } {
  return { payload: { injList: Object.entries(designations).map(([playerID, designation]) => ({ playerID, designation })) } };
}

function news(stories: readonly (readonly [string, string])[]): { readonly payload: unknown } {
  return { payload: stories.map(([title, link]) => ({ title, link })) };
}

describe("injuryDesignationsIn", () => {
  it("keys the current designations by the provider's player id", () => {
    expect(injuryDesignationsIn(injuries({ a: "Q", b: "O" }))).toEqual(new Map([["a", "Q"], ["b", "O"]]));
  });

  it("leaves out an entry with no designation rather than mapping it to an empty claim", () => {
    expect(injuryDesignationsIn({ payload: { injList: [{ playerID: "a", designation: "" }] } })).toEqual(new Map());
  });

  it("reads a payload that is not an injury report as naming nobody", () => {
    expect(injuryDesignationsIn({ payload: { nothing: true } })).toEqual(new Map());
    expect(injuryDesignationsIn({ payload: null })).toEqual(new Map());
  });
});

describe("harvestDesignationDiff", () => {
  it("names only the players whose designation changed value", () => {
    expect(harvestDesignationDiff(injuries({ a: "Q", b: "O" }), injuries({ a: "O", b: "O" }))).toEqual(["a"]);
  });

  it("names a player the feed added", () => {
    expect(harvestDesignationDiff(injuries({}), injuries({ a: "Q" }))).toEqual(["a"]);
  });

  it("names a player the feed dropped, because absence is now the claim", () => {
    expect(harvestDesignationDiff(injuries({ a: "Q" }), injuries({}))).toEqual(["a"]);
  });

  it("names nobody for an unchanged capture", () => {
    expect(harvestDesignationDiff(injuries({ a: "Q", b: "O" }), injuries({ b: "O", a: "Q" }))).toEqual([]);
  });

  it("names nobody for a first capture, since there is no claim it contradicts", () => {
    expect(harvestDesignationDiff(null, injuries({ a: "Q" }))).toEqual([]);
  });
});

describe("newsLinksIn", () => {
  it("groups links by the name in front of the title's first colon", () => {
    const links = newsLinksIn(news([["Volume Back: back at practice", "https://example.test/one"]]));
    expect(links.get("Volume Back")).toEqual(new Set(["https://example.test/one"]));
  });

  it("skips a title with no name in front of it", () => {
    expect(newsLinksIn(news([["no colon here", "https://example.test/one"]]))).toEqual(new Map());
  });
});

describe("harvestNewsDiff", () => {
  it("names a player whose headline set gained a story", () => {
    const before = news([["Volume Back: back at practice", "https://example.test/one"]]);
    const after = news([
      ["Volume Back: back at practice", "https://example.test/one"],
      ["Volume Back: full go Sunday", "https://example.test/two"],
    ]);
    expect(harvestNewsDiff(before, after)).toEqual(["Volume Back"]);
  });

  it("names a player whose story dropped off the feed's window", () => {
    const before = news([["Volume Back: back at practice", "https://example.test/one"]]);
    expect(harvestNewsDiff(before, news([]))).toEqual(["Volume Back"]);
  });

  it("names nobody when the same stories come back in a different order", () => {
    const one: readonly [string, string] = ["Volume Back: one", "https://example.test/one"];
    const two: readonly [string, string] = ["Volume Back: two", "https://example.test/two"];
    expect(harvestNewsDiff(news([one, two]), news([two, one]))).toEqual([]);
  });

  it("names nobody for a first capture", () => {
    expect(harvestNewsDiff(null, news([["Volume Back: one", "https://example.test/one"]]))).toEqual([]);
  });
});
