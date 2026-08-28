import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn, stripCommentsPreservingLines, bannedLines } from "./test-support";

/**
 * THE MAGNITUDE BUDGET: heat colour is a number's own ink, and never anything else.
 *
 * Rule 1 gained magnitude on 2026-08-27 (`docs/design/2026-08-27-fun-pass-spec.md`) with one
 * hard boundary attached: **magnitude may never appear on a control.** That boundary is what
 * keeps "green fill = action" intact — a product where a button can be green because a number
 * beside it is good has spent the one signal it had for "press this."
 *
 * A prefix ban (`bg-mag-`, `ring-mag-`, `border-mag-`) would enforce the letter of that and miss
 * the point, because the next spelling nobody thought of is always the one that ships. So this
 * sweep is narrower and stronger, and it is the same shape as the position-sticker rule the
 * palette already lives by (only `PositionBadge` and the board's cells may spell `pos-*`):
 * **`Stat` is the only file in the product allowed to name a magnitude colour at all.** A `Stat`
 * renders a `<span>`, so magnitude cannot reach a control without first reaching a file this
 * test fails on.
 *
 * Blunt on purpose: the banned string is `-mag-`, which catches `text-mag-good` and
 * `bg-mag-strong` and `hover:border-mag-bad` alike. A new magnitude use starts its life by
 * earning an allowlist entry here, in review, with a reason — the same bargain
 * `accent-budget.source.test.ts` strikes next door, whose stripper this shares.
 */

const SWEPT_DIRS = ["src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room", "src/app"];

/** The one renderer of magnitude colour in the product. */
const MAGNITUDE_ALLOWLIST: readonly string[] = ["src/components/ui/stat.tsx"];

const REPO_ROOT = process.cwd();
const MAGNITUDE_CLASS = "-mag-";

const files = sourceFilesIn(SWEPT_DIRS, ".tsx");
const sweptFiles = files.filter((file) => !MAGNITUDE_ALLOWLIST.includes(file));

describe("nothing but Stat spends the magnitude budget", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(sweptFiles.length).toBeGreaterThanOrEqual(50);
    // Every swept directory pinned by name, LITERALLY — never by iterating `SWEPT_DIRS`, which
    // would delete the assertion along with the entry it was meant to defend.
    expect(sweptFiles.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/app"))).toBe(true);
    expect(sweptFiles.some((file) => file.includes(".test."))).toBe(false);
  });

  it("keeps the allowlist honest: the one exempted file exists and still renders the ink", () => {
    // An entry whose file dropped its magnitude classes (or was renamed) is dead armor — this
    // fails to say "remove the allowlist entry" rather than rotting quietly.
    for (const file of MAGNITUDE_ALLOWLIST) {
      expect(files).toContain(file);
      expect(stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, file), "utf8"))).toContain(MAGNITUDE_CLASS);
    }
  });

  it.each(sweptFiles)("%s names no magnitude colour", (file) => {
    expect(bannedLines(file, readFileSync(join(REPO_ROOT, file), "utf8"), MAGNITUDE_CLASS)).toEqual([]);
  });

  /** The scan's own proof of bite: a fill, a boundary and a ring all fail, and a comment does not. */
  it("catches magnitude on a control in every spelling a control could wear", () => {
    expect(bannedLines("f.tsx", `<button className="bg-mag-strong px-4" />`, MAGNITUDE_CLASS)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<button className="border border-mag-bad" />`, MAGNITUDE_CLASS)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<a className="ring-mag-good focus:ring-2" />`, MAGNITUDE_CLASS)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<span className="text-mag-weak" />`, MAGNITUDE_CLASS)).toHaveLength(1);
    expect(bannedLines("f.tsx", `/* Stat paints text-mag-good */\nconst quiet = true;`, MAGNITUDE_CLASS)).toEqual([]);
    expect(bannedLines("f.tsx", `<i />\n<b className="bg-mag-bad" />`, MAGNITUDE_CLASS)).toEqual([`f.tsx:2: <b className="bg-mag-bad" />`]);
  });
});
