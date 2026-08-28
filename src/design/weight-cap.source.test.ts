import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn, bannedLines } from "./test-support";

/**
 * THE WEIGHT CAP: one typeface, nothing heavier than 600, and dynamic range from SIZE.
 *
 * v3 converged every display call site from `font-bold` (700) to `font-semibold` (600) —
 * self-ruling S4, the mock's own ramp asks for 650 and 600 is the nearest loaded Geist weight —
 * and `docs/design-system.md` recorded the result as "zero occurrences across the swept
 * directories, proven by grep repo-wide rather than claimed." Grep at a moment in time is not a
 * gate, and the fun pass is exactly the pressure that would break this one: the whole point of
 * Task 3's widened display scale is that a number gets loud by getting BIG, and the cheap
 * alternative an author reaches for under deadline is a heavier face.
 *
 * So the claim becomes a test. Same seven directories, same stripper and the same comment
 * carve-out as `accent-budget.source.test.ts` next door: `page-title.tsx`'s docblock records why
 * its rendered class is `font-semibold` and prose is not a rendered class.
 *
 * No allowlist, deliberately. There is no surface in this product that has earned 700, and an
 * empty allowlist is the honest expression of that — a future exception argues for itself here,
 * in review, against rule 2.
 */

const SWEPT_DIRS = ["src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room", "src/app"];

/** Every Tailwind weight above the 600 cap. `font-semibold` (600) is the ceiling and is allowed. */
const BANNED_WEIGHTS: readonly string[] = ["font-bold", "font-extrabold", "font-black"];

const REPO_ROOT = process.cwd();
const files = sourceFilesIn(SWEPT_DIRS, ".tsx");

describe("nothing in the product is set heavier than the 600 weight cap", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(files.length).toBeGreaterThanOrEqual(50);
    // Every swept directory pinned by name, LITERALLY — never by iterating `SWEPT_DIRS`, which
    // would delete the assertion along with the entry it was meant to defend.
    expect(files.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(files.some((file) => file.startsWith("src/app"))).toBe(true);
    expect(files.some((file) => file.includes(".test."))).toBe(false);
  });

  it.each(files)("%s sets nothing heavier than 600", (file) => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    for (const weight of BANNED_WEIGHTS) {
      expect(bannedLines(file, source, weight)).toEqual([]);
    }
  });

  /** The scan's own proof of bite: the cap's own weight passes, everything above it fails, and a
   *  comment recording the history of a weight nobody renders any more does not. */
  it("catches a heavier face and exempts the comment that remembers one", () => {
    expect(bannedLines("f.tsx", `<h1 className="font-bold" />`, "font-bold")).toHaveLength(1);
    expect(bannedLines("f.tsx", `<h1 className="font-black" />`, "font-black")).toHaveLength(1);
    expect(bannedLines("f.tsx", `<h1 className="font-semibold" />`, "font-bold")).toEqual([]);
    expect(bannedLines("f.tsx", `// this used to be font-bold\nconst quiet = true;`, "font-bold")).toEqual([]);
  });
});
