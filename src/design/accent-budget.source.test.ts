import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn } from "./test-support";

/**
 * THE ACCENT BUDGET, APPLIED TO SOURCE: green is money and seats filling, never a button.
 *
 * v3 "Sunday Standard" rule 5 (one ink action per view) plus rule 1 (color is meaning) retire
 * the accent-filled CTA entirely — the 2026-08-24 UX remediation audit counted 17 solid
 * `bg-accent` fills, eleven of them hand-rolled copies of the same CTA class string (E8), two of
 * them adjacent in one nav (E11). Like the caps charter next door
 * (`no-uppercase.source.test.ts`), the budget only survives the next hundred class strings if a
 * sweep enforces it, so this walks the same directories and bans two spellings:
 *
 * 1. `bg-accent` — an accent FILL — anywhere outside the sanctioned data primitives. Money
 *    green may fill a meter segment, a seat dot, a celebration tint, an avatar preset, a
 *    my-row tint: places where green MEANS something (seats filling, your own row). It may
 *    never again fill a control. Blunt on purpose: `bg-accent/10` and any future
 *    `bg-accent-*` compound match too, so a new tint starts its life by earning an allowlist
 *    entry here, in review, with a reason.
 * 2. `bg-text-primary` — the ink pill's own fill (self-ruling S2: ink on ground is the text
 *    color inverted, no new role) — anywhere outside the two button primitives. One primitive,
 *    one budget: the pill the mock ships can never be hand-rolled back into a call site the
 *    way the accent CTA was.
 *
 * Comments are stripped first (newlines preserved, so a hit names its real line) — the same
 * carve-out `no-raw-color.source.test.ts` makes: `badge.tsx`'s docblock retells the history of
 * an accent fill it no longer renders, and prose is not a rendered class.
 */

const SWEPT_DIRS = ["src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room", "src/app"];

/**
 * The data primitives where an accent fill IS the meaning (seats filling, money, you).
 * `button.tsx` is deliberately NOT here: its legacy `bg-accent` primary is exactly what this
 * sweep exists to retire — the ink pill (`bg-text-primary`, allowlisted below) replaces it.
 */
const ACCENT_FILL_ALLOWLIST: readonly string[] = [
  "src/components/ui/meter.tsx",
  "src/components/ui/seat-meter.tsx",
  "src/components/ui/celebration.tsx",
  "src/components/ui/avatar.tsx",
  "src/draft-room/components/budget-table.tsx",
];

/**
 * The two sanctioned elements of the one class map (`buttonClassName`, `button.tsx`).
 * `button-link.tsx` never spells the literal itself — it imports the map — but it is the second
 * sanctioned element by name, so a future inline spelling there is a refactor of the map's
 * home, not a violation.
 */
const INK_PILL_ALLOWLIST: readonly string[] = ["src/components/ui/button.tsx", "src/components/ui/button-link.tsx"];

const REPO_ROOT = process.cwd();

const ACCENT_FILL = "bg-accent";
const INK_FILL = "bg-text-primary";

/** `source` with every comment blanked but every newline kept, so offenders keep their line
 *  numbers — the one refinement over `no-raw-color.source.test.ts`'s stripper, which reports
 *  matches rather than lines. */
function stripCommentsPreservingLines(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
}

/** Every line of `source` (comments already exempt) still spelling `banned`, as `file:line`. */
function bannedLines(file: string, source: string, banned: string): readonly string[] {
  return stripCommentsPreservingLines(source)
    .split("\n")
    .map((line, index) => (line.includes(banned) ? `${file}:${index + 1}: ${line.trim()}` : null))
    .filter((line): line is string => line !== null);
}

const files = sourceFilesIn(SWEPT_DIRS, ".tsx");
const accentSweptFiles = files.filter((file) => !ACCENT_FILL_ALLOWLIST.includes(file));
const inkSweptFiles = files.filter((file) => !INK_PILL_ALLOWLIST.includes(file));

describe("nothing outside the sanctioned primitives spends the accent budget", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(accentSweptFiles.length).toBeGreaterThanOrEqual(50);
    // Every swept directory is pinned by name, LITERALLY — never by iterating `SWEPT_DIRS`,
    // which would delete the assertion along with the entry it was meant to defend (the same
    // discipline the caps and hex sweeps name).
    expect(accentSweptFiles.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.startsWith("src/app"))).toBe(true);
    expect(accentSweptFiles.some((file) => file.includes(".test."))).toBe(false);
  });

  it("keeps the accent-fill allowlist honest: every exempted file exists and still renders its fill", () => {
    // An entry whose file dropped its fill (or was renamed) is dead armor — this fails to say
    // "remove the allowlist entry", the same way a stale swept dir would.
    for (const file of ACCENT_FILL_ALLOWLIST) {
      expect(files).toContain(file);
      expect(stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, file), "utf8"))).toContain(ACCENT_FILL);
    }
  });

  it("keeps the ink-pill allowlist honest: both primitives exist, and the class map's home spells the fill", () => {
    for (const file of INK_PILL_ALLOWLIST) {
      expect(files).toContain(file);
    }
    // Only `button.tsx` must carry the literal — it owns the one class map `button-link.tsx`
    // imports (one source of truth, two elements).
    expect(stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, "src/components/ui/button.tsx"), "utf8"))).toContain(INK_FILL);
  });

  it.each(accentSweptFiles)("%s spends no accent fill", (file) => {
    expect(bannedLines(file, readFileSync(join(REPO_ROOT, file), "utf8"), ACCENT_FILL)).toEqual([]);
  });

  it.each(inkSweptFiles)("%s hand-rolls no ink pill", (file) => {
    expect(bannedLines(file, readFileSync(join(REPO_ROOT, file), "utf8"), INK_FILL)).toEqual([]);
  });

  /** The scan's own proof of bite: the exact spellings a Tailwind class ships as fail — the
   *  solid fill, the translucent tint, and the hand-rolled ink pill — while a comment does not. */
  it("catches the fill, the tint, and the hand-rolled ink pill, and exempts comments", () => {
    expect(bannedLines("f.tsx", `<div className="bg-accent px-4" />`, ACCENT_FILL)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<tr className="border-accent bg-accent/10" />`, ACCENT_FILL)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<a className="rounded-pill bg-text-primary text-surface" />`, INK_FILL)).toHaveLength(1);
    expect(bannedLines("f.tsx", `/* the old primary was bg-accent */\nconst quiet = true;`, ACCENT_FILL)).toEqual([]);
    // A hit names file and line, so the failure is its own work list.
    expect(bannedLines("f.tsx", `<i />\n<b className="bg-accent" />`, ACCENT_FILL)).toEqual([`f.tsx:2: <b className="bg-accent" />`]);
  });
});
