import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROP_MARKETS } from "../odds/props-store";
import { propLineKey } from "./props";

/**
 * THE KEY IS PRINTABLE AND INJECTIVE, and both halves of that are tested here.
 *
 * The first version of this key joined the tuple on literal NUL bytes. NUL is an unambiguous
 * delimiter and was still the wrong choice: it made git classify the module as BINARY, and a binary
 * file does not appear in a diff — so the module was invisible to the review that was reading it.
 * These tests pin both properties so neither can regress: the key must contain nothing outside
 * printable ASCII, and two different tuples must never collide however adversarial the field
 * contents are.
 */

const MARKET = PROP_MARKETS[0];

/**
 * Control characters, spelled as a constructed pattern rather than a literal character class — for
 * the very reason this suite exists. A source file that embedded a NUL in order to test for NULs
 * would itself stop being a text file, which is the defect rather than the test for it.
 */
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]");

/** A NUL, built at runtime. The point is to prove the KEY survives a hostile field, without the
 *  hostile byte ever appearing in this file. */
const NUL = String.fromCharCode(0);

describe("propLineKey", () => {
  it("contains no control characters at all — the property that cost the last version its diff", () => {
    const key = propLineKey("00-0036900", MARKET, "draftkings");
    expect(CONTROL_CHARACTERS.test(key)).toBe(false);
    expect(key).toBe('["00-0036900","player_pass_yds","draftkings"]');
  });

  it("stays printable even when a FIELD is not — a bookmaker key carrying a NUL", () => {
    const key = propLineKey("00-0036900", MARKET, `book${NUL}name`);
    expect(CONTROL_CHARACTERS.test(key)).toBe(false);
    expect(key).toContain("\\u0000");
  });

  it("is stable: the same tuple always produces the same key", () => {
    expect(propLineKey("00-0036900", MARKET, "fanduel")).toBe(propLineKey("00-0036900", MARKET, "fanduel"));
  });

  it("separates tuples that differ in any one field", () => {
    const base = propLineKey("00-0036900", MARKET, "draftkings");
    expect(propLineKey("00-0036322", MARKET, "draftkings")).not.toBe(base);
    expect(propLineKey("00-0036900", PROP_MARKETS[1], "draftkings")).not.toBe(base);
    expect(propLineKey("00-0036900", MARKET, "fanduel")).not.toBe(base);
  });

  it("cannot be spoofed by a field whose own content imitates a delimiter", () => {
    // Each of these carries a character somebody might have picked as a separator. JSON escaping is
    // what keeps them distinct, and it needs no claim about what a bookmaker key or a gsis id can
    // never contain — which is exactly the claim a single-character delimiter would have forced this
    // module to keep re-earning every time the odds API changed.
    const adversarial: readonly (readonly [string, string])[] = [
      ["00-0036900", "draftkings"],
      ['a","b', "c"],
      ["a", '","'],
      ["a|b", "c"],
      ["a", "b|c"],
      ["a b", "c"],
      ["a", "b c"],
      ["a", "b"],
      ["a\\", "b"],
      ["[", "]"],
      ['\\","', "x"],
      [`a${NUL}b`, "c"],
      ["a", `b${NUL}c`],
    ];
    const keys = adversarial.map(([playerId, bookmaker]) => propLineKey(playerId, MARKET, bookmaker));
    expect(new Set(keys).size).toBe(adversarial.length);
  });

  it("round-trips, which is what injectivity actually means here", () => {
    for (const bookmaker of ["draftkings", 'a","b', "book\\slash", "  spaced  ", "|", "[", `n${NUL}l`]) {
      expect(JSON.parse(propLineKey("00-0036900", MARKET, bookmaker))).toEqual(["00-0036900", MARKET, bookmaker]);
    }
  });
});

/**
 * THE REGRESSION GUARD FOR THE WHOLE MODULE, not only for the one function that caused it.
 *
 * The NUL delimiter was not a bug in the register's logic — every test passed with it in place, and
 * the map keys were correct. What it broke was the file's REVIEWABILITY: git stops diffing a file
 * that contains a NUL in its first eight kilobytes, so the module silently dropped out of the change
 * set it was part of. Nothing in a normal test suite notices that, which is exactly why it needs its
 * own assertion rather than a note in a docblock.
 *
 * Directory-derived rather than a list of filenames, the same discipline every source sweep in this
 * repository keeps: a new file in this module is covered the day it exists, not the day somebody
 * remembers to add it here.
 */
describe("every file in the register stays a text file", () => {
  const dir = join(process.cwd(), "research-ts/src/projections/register");
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));

  it("finds the module's files, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const expected of ["store.ts", "freeze.ts", "grade.ts", "props.ts", "test-support.ts"]) {
      expect(files).toContain(expected);
    }
  });

  it.each(["store.ts", "freeze.ts", "grade.ts", "props.ts", "test-support.ts"])(
    "%s contains no control byte that would make git treat it as binary",
    (name) => {
      expect(CONTROL_CHARACTERS.test(readFileSync(join(dir, name), "utf8"))).toBe(false);
    },
  );

  it("holds for every other file in the module too, including the tests themselves", () => {
    const binary = files.filter((name) => CONTROL_CHARACTERS.test(readFileSync(join(dir, name), "utf8")));
    expect(binary).toEqual([]);
  });
});
