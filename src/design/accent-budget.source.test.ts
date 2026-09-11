import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFilesIn, stripCommentsPreservingLines, bannedLines } from "./test-support";

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
 * The primitives where an accent fill IS the meaning (seats filling, money, you) — and, since
 * Gameday, the one control primitive allowed to fill with it.
 *
 * `button.tsx` WAS deliberately excluded here: under v3's rule 5 its legacy `bg-accent` primary
 * was the exact thing this sweep existed to retire, and the ink pill replaced it. Gameday law 5
 * ("the verb is obvious") replaces that rule and brings the fill back on purpose, narrowly: the
 * `verb` variant, `rounded-md`, money-filled, allowed to repeat down a board — see `button.tsx`'s
 * `VARIANT` docblock for why money is the correct pigment for an action rather than a free
 * choice. The budget is unchanged in kind: green may fill exactly one control primitive, and a
 * call site that hand-rolls the class still fails, which was always the failure mode (E8 was
 * eleven copies of one CTA class string drifting apart, not one primitive owning it).
 */
const ACCENT_FILL_ALLOWLIST: readonly string[] = [
  "src/components/ui/meter.tsx",
  // SIDELINE, the doors-and-rooms round (2026-09-10): `seat-meter.tsx` LEFT this list. A seat
  // that is taken is drawn in ink now, not Court blue — `accent` is the one verb (P3), and a
  // twelve-segment blue bar spent the page's loudest pigment on a row's furniture. Its ink is
  // accounted for in `INK_PILL_ALLOWLIST` below.
  // SIDELINE (2026-09-10): `celebration.tsx` left this list. Your own moment now wears the amber
  // wash (`self-wash`, the "yours" channel), never the verb's blue. `message-bubble.tsx` joins
  // it: YOUR message is the Court blue bubble (Sideline: "Court blue: the one verb, links, your
  // messages"), a fill that means "you said this", drawn in exactly one file.
  "src/components/ui/message-bubble.tsx",
  "src/components/ui/avatar.tsx",
  "src/components/ui/button.tsx",
  "src/draft-room/components/budget-table.tsx",
  // GAMEDAY (2026-08-28), law 1. The rail's needs-you dot, earning its entry the way this
  // docblock asks — in review, with a reason. It used to be `bg-warning`, and law 1 demotes
  // amber's USAGE to a clock that is genuinely tightening: a league waiting on your lineup is
  // not a caution, it is an act, and money is this product's pigment for an act (the same clause
  // that makes `Button`'s `verb` variant legal). This is the "seat dot" case the list above
  // already names as a place where green MEANS something, in the one file that draws it. The
  // dot's live sibling is `bg-negative` and needs no exemption. THE RAIL REDESIGN (2026-09-03)
  // moved the dot from `league-rail.tsx` into the extracted row model (`RailDot`) — same dot,
  // same reason, still exactly one file drawing it; `league-rail.tsx` itself no longer spells
  // the fill at all.
  //
  // SIDELINE, the doors-and-rooms round (2026-09-10): `rail-row.tsx` LEFT this list too. The
  // needs-you dot is `bg-self` now — Sideline split "yours" (Streak amber) out of `accent`
  // precisely so a screen full of other people's rows can point at yours without that reading
  // as "press this", and a league waiting on your lineup is the textbook case. Its live sibling
  // moved from rose to `bg-live`, the presence pigment; neither needs an exemption.
  // SUNDAY v5 (2026-08-28), law 4. The lobby's segmented filter rail, earning its entry the way
  // this docblock asks — in review, with a reason. Law 4 spends amber on "furniture and you and
  // the verb", and a filter strip is furniture: the network's own graphics over the board, not a
  // verdict and not an act. The ban's real target is a hand-rolled CTA (E8's eleven copies of one
  // class string); this fill carries no act at all — every segment is a `<Link>` that reorders or
  // narrows the same list. One file draws it, and a call site that hand-rolls the class still
  // fails, which is the property the budget actually protects.
  //
  // SIDELINE, the doors-and-rooms round (2026-09-10): `browse-filters.tsx` LEFT this list. The
  // three surfaces that wear a pill chip — the segmented group, the lobby's filter links and the
  // mock lobby's table chips — now take one exported class function (`chipClassName`,
  // `segment-group.tsx`), so `segment-group.tsx` below is the ONE file that fills a chip and the
  // other two need no exemption at all. That is the property this budget protects, obtained by
  // deleting two spellings rather than by granting two more entries.
  // THE QUILT (2026-09-02), law 4, earning both entries the way this docblock asks — in review,
  // with a reason. The clock strip's your-turn plate is the mock's own amber clock chip: it is
  // "furniture and you" in one surface — the network's clock graphic, filled amber precisely
  // because the turn is YOURS (the room's turns wear `live`, a role with no budget here). The
  // lens switcher is the same case `browse-filters.tsx` already earned: a segmented filter rail
  // is the network's own graphics over the board, carrying no act — every chip recolors the same
  // quilt in place. Each fill is drawn in exactly one file, and a call site that hand-rolls the
  // class string still fails, which is the property the budget actually protects.
  "src/draft-room/quilt/components/clock-strip.tsx",
  "src/draft-room/quilt/components/lens-chips.tsx",
  // V6 FOUNDATION REPAIR (2026-09-03, the quilt-warm branch): two primitives the warmth pass
  // landed without their entries, caught by this sweep the first time it ran after the merge.
  // `ChapterBand`'s `act` plate is the act channel itself — the primitive exists so a chapter
  // that NEEDS you wears the product's one act pigment from a single class map instead of a
  // call site hand-rolling it (the E8 failure mode this budget exists to prevent).
  // `SegmentGroup` is the same segmented-filter case `browse-filters.tsx` and `lens-chips.tsx`
  // already earned: the network's own graphics over a board, carrying no act — every segment
  // re-narrows the same list in place. Each fill is drawn in exactly one file.
  "src/components/ui/chapter-band.tsx",
  // FIX ROUND 3: the chip's fill moved OUT of `segment-group.tsx` into `chip.tsx`, which
  // carries no `"use client"` directive — `BrowseFilters` is a server component on purpose (the
  // URL is the whole filter state, no JavaScript needed), and calling a client module's export
  // during a server render threw at runtime and cost `/browse` its entire filter nav. `chip.tsx`
  // is a `.tsx` with no JSX in it deliberately: this sweep reads `.tsx`, so a `.ts` module would
  // have dodged the guard on a file extension instead of earning its entry here.
  "src/components/ui/chip.tsx",
];

/**
 * The two sanctioned elements of the one class map (`buttonClassName`, `button.tsx`).
 * `button-link.tsx` never spells the literal itself — it imports the map — but it is the second
 * sanctioned element by name, so a future inline spelling there is a refactor of the map's
 * home, not a violation.
 */
const INK_PILL_ALLOWLIST: readonly string[] = [
  // SIDELINE (2026-09-10): the ink pill is RETIRED. There is one solid button in the product and
  // it is Court blue, so `button.tsx` and `button-link.tsx` left this list and the guard below
  // now asserts the class map does NOT spell the fill. The ban itself stays: a hand-rolled black
  // pill is exactly the second loud button P3 forbids.
  // THE SEASON CHART'S LOUDEST BAR (2026-08-28), earning its entry the way this file's own
  // docblock asks — in review, with a reason.
  //
  // The ban's target is stated in rule 2 above: *"the ink pill's own fill … the pill the mock
  // ships can never be hand-rolled back into a call site the way the accent CTA was."* It is a
  // rule about a CONTROL wearing the ink fill. `SeasonBars` draws no control: seventeen
  // `aria-hidden` rectangles with no text on them, no radius-pill, no handler and no focus stop.
  //
  // Why it needs the role at all: the chart bands a week as big, ordinary or bust, and a band is
  // only readable if its three steps are separable IN BOTH THEMES. The neutral ladder has exactly
  // three that are — `text-primary`, `text-muted`, `edge` — and it is strictly decreasing in
  // contrast against the ground in each theme, which is what carries the band with the hue
  // channel switched off. The step below `edge` is `line`, which measures about 1.15:1 on a
  // daylight card and would draw a bust week as nothing at all. The heat map's own pigments are
  // the obvious alternative and are not available: `magnitude-budget.source.test.ts` makes `Stat`
  // the only file allowed to name one, and the number above each bar is where they render.
  "src/components/ui/season-bars.tsx",
  // SIDELINE, the doors-and-rooms round (2026-09-10): the SEAT PRIMITIVES, earning the entry the
  // way this file's own docblock asks — in review, with a reason, and on exactly the grounds
  // `season-bars.tsx` above already established.
  //
  // The ban's target is a CONTROL wearing the ink fill. `SeatMeter` and `SeatStack` draw no
  // control: `total` `aria-hidden` rectangles with no text on them, no handler, no focus stop,
  // decoration for a sentence that is already on screen (their own docblocks). What they need
  // the role for is that a TAKEN seat has to be separable from an OPEN one and from a HELD one
  // in both themes, and the ladder that does that with hue switched off is ink / amber / the
  // well behind `edge`. The fill they left is Court blue, which P3 reserves for the one verb —
  // this is the budget being SPENT DOWN by the change, not widened.
  "src/components/ui/seat-meter.tsx",
];

const REPO_ROOT = process.cwd();

const ACCENT_FILL = "bg-accent";
const INK_FILL = "bg-text-primary";

// `stripCommentsPreservingLines`/`bannedLines` moved to `test-support.ts` when the magnitude
// budget became this sweep's sibling (`magnitude-budget.source.test.ts`) — one stripper, two
// budgets, rather than a second copy that could quietly disagree about what a comment is.

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

  it("keeps the ink-pill allowlist honest: every exempted file exists and still spells the fill, and the button map no longer does", () => {
    for (const file of INK_PILL_ALLOWLIST) {
      expect(files).toContain(file);
      expect(stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, file), "utf8"))).toContain(INK_FILL);
    }
    // SIDELINE: the one class map spells no ink pill. The solid is Court blue, once.
    expect(stripCommentsPreservingLines(readFileSync(join(REPO_ROOT, "src/components/ui/button.tsx"), "utf8"))).not.toContain(INK_FILL);
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
