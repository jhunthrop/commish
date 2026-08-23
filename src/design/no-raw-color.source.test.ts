import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn } from "./test-support";

/**
 * THE ONE-FILE-OF-RAW-COLOR RULE, APPLIED TO SOURCE.
 *
 * `src/design/tokens.ts` is the only file in the repo allowed to contain a color literal
 * (docs/design-system.md). The rule has existed in prose since Phase 1 and has been enforced by
 * review three times over — never by a test, until now. v2 is the plan that writes more class
 * strings than any before it, which is exactly why a hex slipping into a `className` stops
 * being something a reviewer might catch by eye.
 *
 * DIRECTORY-DERIVED, the same reasoning `src/integrity/room-copy.source.test.ts` already
 * established for the copy rules: a hand-maintained list of surfaces misses the one nobody
 * remembered to add, a walker sweeps a new component the moment it exists.
 *
 * Three shapes fail the sweep: a hex literal (`#0B0C0F`, `#fff`), an `rgb(`/`rgba(` literal,
 * and — for free, since both of the above match wherever they appear — a Tailwind arbitrary
 * value bracket that contains one (`text-[#fff]`, `bg-[rgba(0,0,0,.4)]`). Comments are stripped
 * first: a docblock explaining a token's hex (as `tokens.ts` itself does) is not a rendered
 * color, the same carve-out `room-copy.source.test.ts` makes for engineering prose.
 */

const SWEPT_DIRS = ["src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room", "src/app"];

const REPO_ROOT = process.cwd();

const HEX_LITERAL = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F])/;
const RGB_LITERAL = /\brgba?\(/;

/** `source` with every comment removed — the one thing in a `.tsx` file that is never rendered. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every raw-color literal `stripComments(source)` still contains, named by its own text. */
function rawColorsIn(source: string): readonly string[] {
  const rendered = stripComments(source);
  const hexes = rendered.match(new RegExp(HEX_LITERAL, "g")) ?? [];
  const rgbs = rendered.match(new RegExp(RGB_LITERAL, "g")) ?? [];
  return [...hexes, ...rgbs];
}

const files = sourceFilesIn(SWEPT_DIRS, ".tsx");

describe("nothing outside src/design/tokens.ts renders a color it invented", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
    // Every swept directory is pinned by name, LITERALLY — never by iterating `SWEPT_DIRS`,
    // which would delete the assertion along with the entry it was meant to defend (the same
    // discipline `room-copy.source.test.ts`'s own guard names).
    expect(files.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/app"))).toBe(true);
    // Its own tests, and the module holding this scan's helpers, are things DOING the checking
    // rather than things being checked.
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });

  /** A directory that does not exist answers empty rather than throwing — the scan names its
   *  directories by hand, and a rename should not take the whole suite down with an ENOENT. */
  it("answers empty for a directory that is not there", () => {
    expect(sourceFilesIn(["src/no-such-room"], ".tsx")).toEqual([]);
  });

  it.each(files)("%s invents no color of its own", (file) => {
    const offenders = rawColorsIn(readFileSync(join(REPO_ROOT, file), "utf8"));
    expect(offenders).toEqual([]);
  });

  /**
   * The scan's own proof of bite, so it never becomes a green test over an extractor that
   * stopped extracting. One hex literal in a `className`, one `rgba(` in an inline style — the
   * two shapes a raw color actually ships in.
   */
  it("catches a hex literal in a className and an rgb() literal in an inline style", () => {
    expect(rawColorsIn(`<div className="border border-[#1a2b3c]" />`)).toEqual(["#1a2b3c"]);
    expect(rawColorsIn(`<div style={{ background: "rgba(0, 0, 0, 0.4)" }} />`)).toEqual(["rgba("]);
  });

  /** And its own proof it is not simply blanking everything: a docblock hex is exempt (the
   *  rule is about what RENDERS, and `tokens.ts` itself documents its own hexes in prose the
   *  same way) while the same literal one line later, in a rendered string, is not. */
  it("exempts comments and nothing else", () => {
    const source = `/** The mock's ground color is #0B0C0F. */\nconst className = "bg-[#0B0C0F]";`;
    expect(rawColorsIn(source)).toEqual(["#0B0C0F"]);
  });
});
