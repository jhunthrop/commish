import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn } from "./test-support";
import { MICRO_LABEL } from "@/components/ui/config";

/**
 * THE CAPS CHARTER, APPLIED TO SOURCE: no `.tsx` file spells the word Tailwind uses to shout.
 *
 * v3 "Sunday Standard" rule 3 removed every `text-transform: uppercase` from the product —
 * league names, eyebrows, section labels, wordmarks, chips, all of it (the 2026-08-24 UX
 * remediation audit inventoried 43 sites). Like the hex ban next door
 * (`no-raw-color.source.test.ts`), the rule only survives contact with the next hundred class
 * strings if a test enforces it, so this sweep walks the same directories and fails any `.tsx`
 * file that spells `uppercase`.
 *
 * GAMEDAY (v4) CARVES OUT ONE ADDRESS, NOT ONE EXCEPTION PER CALL SITE. The design system's
 * "What stays" clause reads: *"Sentence case in prose. Uppercase survives only in mono
 * micro-labels, where every sports interface has always put it."* The sweep below is therefore
 * UNCHANGED in strictness — no `.tsx` may spell the class — and the one sanctioned all-caps
 * register lives in `src/components/ui/config.ts` as `MICRO_LABEL`, a `.ts` file this sweep does
 * not walk because it renders nothing.
 *
 * That placement is the whole enforcement: a component that wants shouted capitals imports the
 * constant, and a component that hand-rolls the class still fails here. The charter's real
 * target was forty-three treatments drifting apart from one another, and routing every one of
 * them through a single constant is the opposite of that rather than a hole in it. The guard
 * test below pins `MICRO_LABEL`'s existence and spelling, so the carve-out cannot silently
 * become "uppercase is fine again" by the constant being deleted or renamed.
 *
 * MATCHING IS DELIBERATELY BLUNT — the raw, case-sensitive string, comments included:
 *
 * - Case-SENSITIVE, so `.toUpperCase()` never matches. That is the charter's own data
 *   carve-out (S6): initials ("Bay Bandits" → "BB") and crest letters are semantically
 *   capitals — data, not styled shouting — and the sweep has no opinion about them.
 * - No comment stripping, unlike the hex sweep. A banned color literal in a docblock is
 *   harmless prose, but this ban is on one WORD, and a comment keeping that word alive is one
 *   paste away from a `className`. Engineering prose says "caps" or "all-caps" instead.
 *
 * TWO FILES ARE ALLOWLISTED (self-ruling S6): `position-badge.tsx` and `crest.tsx`. "QB" and
 * "BB" are acronym data, not prose — the class there guards against a lowercase data bug, not
 * a typographic choice. The guard test below asserts both still contain the string, so an
 * allowlist entry that stops earning its exemption fails loudly instead of rotting.
 */

const SWEPT_DIRS = ["src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room", "src/app"];

const ALLOWLIST: readonly string[] = ["src/components/ui/position-badge.tsx", "src/components/ui/crest.tsx"];

const REPO_ROOT = process.cwd();

const BANNED = "uppercase";

const files = sourceFilesIn(SWEPT_DIRS, ".tsx");
const sweptFiles = files.filter((file) => !ALLOWLIST.includes(file));

describe("nothing outside the acronym allowlist forces text to uppercase", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(sweptFiles.length).toBeGreaterThanOrEqual(50);
    // Every swept directory is pinned by name, LITERALLY — never by iterating `SWEPT_DIRS`,
    // which would delete the assertion along with the entry it was meant to defend (the same
    // discipline `no-raw-color.source.test.ts` and `room-copy.source.test.ts` name).
    expect(sweptFiles.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/app"))).toBe(true);
    expect(sweptFiles.some((file) => file.includes(".test."))).toBe(false);
  });

  it("keeps the allowlist honest: both exempted files exist and still carry the class", () => {
    // If either file drops its acronym guard (or is renamed), its entry here is dead armor —
    // this fails to say "remove the allowlist entry", the same way a stale swept dir would.
    for (const file of ALLOWLIST) {
      expect(files).toContain(file);
      expect(readFileSync(join(REPO_ROOT, file), "utf8")).toContain(BANNED);
    }
  });

  it.each(sweptFiles)("%s never spells uppercase", (file) => {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    const offendingLines = source
      .split("\n")
      .map((line, index) => (line.includes(BANNED) ? `${file}:${index + 1}: ${line.trim()}` : null))
      .filter((line): line is string => line !== null);
    expect(offendingLines).toEqual([]);
  });

  /** The scan's own proof of bite: the exact string a Tailwind class ships as is what fails,
   *  while the data transform the charter exempts (capital U) does not. */
  it("catches the class string and exempts the data transform", () => {
    expect('className="uppercase tracking-wide"'.includes(BANNED)).toBe(true);
    expect("name.slice(0, 2).toUpperCase()".includes(BANNED)).toBe(false);
  });

  /**
   * GAMEDAY'S ONE ADDRESS FOR CAPITALS, pinned. `MICRO_LABEL` is the only sanctioned all-caps
   * register in the product (see this file's docblock), and it earns that by living in a `.ts`
   * module the sweep above does not walk. Two ways that could rot silently, both closed here:
   * the constant is deleted or renamed (and every micro-label goes back to being hand-rolled),
   * or it quietly stops being all-caps (and the carve-out is dead armor protecting nothing).
   */
  it("keeps the one sanctioned all-caps register alive, and actually capitalised", () => {
    const config = readFileSync(join(REPO_ROOT, "src/components/ui/config.ts"), "utf8");
    expect(config).toContain("export const MICRO_LABEL");
    expect(config).toContain(BANNED);
    // SIDELINE (2026-09-10): the carve-out is narrow on SIZE and WEIGHT rather than on the face.
    // The mock's one all-caps treatment is a 12px chapter label in the body face at 600; capitals
    // stay legible there and can never become a heading while this pins `text-xs`. Through v5 the
    // guard asked for `font-mono`, the timing tower's own register, which Sideline retires.
    expect(MICRO_LABEL).toContain("text-xs");
    expect(MICRO_LABEL).toContain("font-semibold");
    expect(MICRO_LABEL).not.toContain("font-display");
    expect(MICRO_LABEL).toContain(BANNED);
  });
});
