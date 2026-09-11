import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn, stripCommentsPreservingLines, bannedLines } from "./test-support";

/**
 * THE WARMTH PASS, APPLIED TO SOURCE: no call site hand-rolls the hairline box v6 retired.
 *
 * V6 (founder 2026-09-03: "more roundness and friendliness... it's kind of rigid feeling")
 * replaces the `border border-line` surface box — the straightedge's default material — with
 * soft fills on the elevation ladder plus the shadow tokens. The migration converted 50+ sites
 * in one sweep (`docs/superpowers/specs/2026-09-03-v6-foundation-design.md`), and like the
 * accent budget and the caps charter beside this file, the conversion only survives the next
 * hundred class strings if a sweep enforces it. So this walks the same directories and fails
 * any `.tsx` OUTSIDE `src/components/ui` that spells the retired combo.
 *
 * WHAT IS BANNED, PRECISELY: the literal `border border-line` — a full hairline box drawn in
 * the decorative line role. What is deliberately NOT banned, because each is a different rule:
 *
 * - `border-b border-line`, `border-t`, `divide-*` — an EDGE is data separation (a table's row
 *   rule, a strip's divider), which law 3 keeps and the warmth pass never touched.
 * - `border border-dashed border-line` — the dashed placeholder outline is the WarmQuilt mock's
 *   OWN empty-slot furniture (a spine slot, an open seat). The dash is the semantics.
 * - `border-edge` — a CONTROL's boundary, held to WCAG 1.4.11's 3:1. Controls keep borders.
 * - `border-accent` and the tone borders — semantic attention/verdict boundaries with their own
 *   budgets; the v6 treatment for attention CARDS (wash + ring) is a per-site design call, not
 *   a mechanical spelling this sweep could judge.
 * - Raw `uppercase` label styling — the warmth pass's OTHER retired combo — is already
 *   `no-uppercase.source.test.ts`'s whole job, one door over. Extended there, not duplicated
 *   here (engineering prose in this file says "caps" for the same reason that file names).
 *
 * `src/components/ui` is exempt wholesale: the primitives OWN the surface vocabulary — `Card`'s
 * `outline` variant is the one sanctioned spelling of a hairline box, and a call site that wants
 * one imports it rather than spelling the classes (the guard test below pins that address).
 * Comments are stripped first (newlines preserved, so a hit names its real line), the hex
 * sweep's carve-out: a docblock retelling the border's history is prose, not a rendered class.
 */

const SWEPT_DIRS = ["src/components", "src/league-room", "src/draft-room", "src/chat-room", "src/account-room", "src/admin-room", "src/app"];

/**
 * The earned exceptions, each with its reason — mirroring the accent budget's discipline: an
 * entry lands here in review, with a sentence, and the guard test keeps it honest.
 */
const ALLOWLIST: readonly string[] = [
  // A native <select>'s boundary: a form control the user must FIND, so its border is a control
  // affordance (WCAG 1.4.11's territory), not surface decoration — controls keep borders under
  // v6. Migrating it to the Select primitive is real work with behavior on the line, out of a
  // class-only pass's scope; the entry retires with that migration.
  "src/account-room/components/review-feed.tsx",
  // SIDELINE, THE WIRE (2026-09-11): `room-surface-players.tsx` LEFT this list. Its search box is
  // the mock's 40px pill field now — `border-edge` on the elevated fill, the same control
  // boundary `Input` itself draws — so there is no hairline box left in the file to exempt.
  // The LEGACY draft board. Its empty-cell hairlines are a founder-reported live-defect fix
  // (2026-08-25: opacity-diluted borders read rounds 3-15 as a void), pinned at full strength by
  // `draft-board.test.tsx`'s own regression suite — softening them here would re-open a ruled
  // defect from a class sweep. The quilt is the board's successor; this entry retires with the
  // file.
  "src/draft-room/components/draft-board.tsx",
];

const REPO_ROOT = process.cwd();

const BANNED = "border border-line";

/** The one sanctioned address for a hairline box: the Card primitive's outline variant. */
const SANCTIONED_HOME = "src/components/ui/card.tsx";

const files = sourceFilesIn(SWEPT_DIRS, ".tsx");
const sweptFiles = files.filter((file) => !file.startsWith("src/components/ui/") && !ALLOWLIST.includes(file));

describe("nothing outside the ui primitives hand-rolls the retired hairline box", () => {
  it("finds the component files to sweep, so an empty scan can never pass silently", () => {
    expect(sweptFiles.length).toBeGreaterThanOrEqual(50);
    // Every swept directory is pinned by name, LITERALLY — never by iterating `SWEPT_DIRS`,
    // which would delete the assertion along with the entry it was meant to defend (the same
    // discipline the caps, hex and accent sweeps name).
    expect(sweptFiles.some((file) => file.startsWith("src/components"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/league-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/draft-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/chat-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/account-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/admin-room"))).toBe(true);
    expect(sweptFiles.some((file) => file.startsWith("src/app"))).toBe(true);
    expect(sweptFiles.some((file) => file.includes(".test."))).toBe(false);
    expect(sweptFiles.some((file) => file.startsWith("src/components/ui/"))).toBe(false);
  });

  it("keeps the allowlist honest: every exempted file exists and still carries the combo", () => {
    // An entry whose file dropped its border (or was renamed) is dead armor — this fails to say
    // "remove the allowlist entry", the same way a stale swept dir would.
    for (const file of ALLOWLIST) {
      expect(files).toContain(file);
      expect(stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, file), "utf8"))).toContain(BANNED);
    }
  });

  it("keeps the one sanctioned address alive: Card's outline variant still owns the spelling", () => {
    // Two rots closed here, the caps charter's own pattern: the variant is deleted (and the next
    // semantic border gets hand-rolled), or it quietly stops spelling the hairline (dead armor).
    const card = stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, SANCTIONED_HOME), "utf8"));
    expect(card).toContain("outline");
    expect(card).toContain(BANNED);
  });

  it.each(sweptFiles)("%s hand-rolls no border-line surface box", (file) => {
    expect(bannedLines(file, readFileSync(join(REPO_ROOT, file), "utf8"), BANNED)).toEqual([]);
  });

  /** The scan's own proof of bite: the raw box fails; the edge rule, the dashed placeholder and
   *  a comment do not. */
  it("catches the hairline box and exempts edges, dashed placeholders and comments", () => {
    expect(bannedLines("f.tsx", `<div className="rounded-lg border border-line bg-surface-elevated p-4" />`, BANNED)).toHaveLength(1);
    expect(bannedLines("f.tsx", `<tr className="border-b border-line" />`, BANNED)).toEqual([]);
    expect(bannedLines("f.tsx", `<li className="border border-dashed border-line" />`, BANNED)).toEqual([]);
    expect(bannedLines("f.tsx", `/* the old box was border border-line */\nconst quiet = true;`, BANNED)).toEqual([]);
    // A hit names file and line, so the failure is its own work list.
    expect(bannedLines("f.tsx", `<i />\n<b className="border border-line" />`, BANNED)).toEqual([`f.tsx:2: <b className="border border-line" />`]);
  });
});
