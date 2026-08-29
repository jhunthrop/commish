import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn, bannedLines } from "./test-support";

/**
 * THE WEIGHT CHARTER, SUNDAY v5: weight above 600 belongs to the display face alone.
 *
 * HISTORY, because this sweep has now reversed once and the reversal must not read as drift.
 * v3 capped the whole product at 600 (self-ruling S4) and this file's first charter said "no
 * allowlist, deliberately — there is no surface in this product that has earned 700; a future
 * exception argues for itself here, in review, against rule 2." Sunday v5 is that argument,
 * made and won (founder-approved 2026-08-28, `docs/design/2026-08-28-sunday-spec.md`): the
 * timing tower's whole register is a condensed athletic face at broadcast weights, and law 3
 * makes the heavy condensed face LOAD-BEARING — it is what buys ten columns at 18px.
 *
 * What did NOT change: the body face still caps at 600. A sentence set bold is still the cheap
 * loudness the old charter guarded against, and Saira loads no weight above 600, so a stray
 * `font-bold` on body text would silently faux-bold in the browser — the sweep now exists to
 * catch exactly that. The testable rule: a line carrying `font-bold` or `font-extrabold` must
 * also carry `font-display`. `font-black` (900) stays banned outright; no face loads it.
 */

const SWEPT_DIRS = [
  "src/components",
  "src/league-room",
  "src/draft-room",
  "src/chat-room",
  "src/account-room",
  "src/admin-room",
  "src/app",
];

/** Weights above 600 that only the display face has earned. */
const DISPLAY_ONLY_WEIGHTS: readonly string[] = ["font-bold", "font-extrabold"];
/** No loaded face carries 900; this one stays banned everywhere. */
const BANNED_WEIGHTS: readonly string[] = ["font-black"];

const REPO_ROOT = process.cwd();
const files = sourceFilesIn(SWEPT_DIRS, ".tsx");

/** The heavy-weight lines in `source` that do NOT also declare the display face. */
function bodyFaceHeavyLines(file: string, source: string): readonly string[] {
  return DISPLAY_ONLY_WEIGHTS.flatMap((weight) =>
    bannedLines(file, source, weight).filter((line) => !line.includes("font-display")),
  );
}

describe("weight above 600 belongs to the display face alone", () => {
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

  it.each(files)("%s puts weight above 600 only on the display face", (file) => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    expect(bodyFaceHeavyLines(file, source)).toEqual([]);
    for (const weight of BANNED_WEIGHTS) {
      expect(bannedLines(file, source, weight)).toEqual([]);
    }
  });

  /** The scan's own proof of bite: a bold display line passes, a bold body line fails, 900
   *  fails everywhere, and a comment remembering an old weight does not fail. */
  it("catches a heavy body face and passes the same weight on the display face", () => {
    expect(bodyFaceHeavyLines("f.tsx", `<h1 className="font-display font-bold" />`)).toEqual([]);
    expect(bodyFaceHeavyLines("f.tsx", `<h1 className="font-bold" />`)).toHaveLength(1);
    expect(bodyFaceHeavyLines("f.tsx", `<p className="font-extrabold" />`)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<h1 className="font-display font-black" />`, "font-black")).toHaveLength(1);
    expect(bodyFaceHeavyLines("f.tsx", `// this used to be font-bold\nconst quiet = true;`)).toEqual([]);
  });
});
