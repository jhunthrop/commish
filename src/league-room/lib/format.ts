import { absoluteInstant } from "./day-chapters";

/** Display only. Every number here was already computed and rounded on the server. */
export function formatRecord({ wins, losses, ties }: { readonly wins: number; readonly losses: number; readonly ties: number }): string {
  return ties === 0 ? `${wins}-${losses}` : `${wins}-${losses}-${ties}`;
}

export function formatPoints(points: number): string {
  return points.toFixed(2);
}

/**
 * What a leaguemate is called out loud. "Rey Moreno" is a row label; "Rey" is how the room talks
 * about him ("You are 4 and 1 against Rey", "Rey and Dana are here", "Offer Rey a trade"), which is
 * P7's whole rule about saying it the way a friend in the group chat would.
 *
 * One copy, here, because there were three: `who-is-here.tsx`, `player-header.tsx` and the rival
 * card's own head-to-head line. A single-word display name is already its own first name, and a
 * blank one falls back to what it was given rather than to an empty string.
 */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * THE NUMBER FORMATTERS LIVE IN THE UI LAYER (review, MINOR) and are re-exported here: the shared
 * primitives under `components/ui` need them too (a reason chip states a law's effect to one
 * decimal), and they may not import from a feature folder. One definition, both layers, and every
 * existing `../lib/format` import keeps working.
 */
export { countWord, countWordCapitalized, formatLine, formatTenth, formatWhole } from "@research-ts/lib/number-format";

export function formatWeek(weekNumber: number): string {
  return `Week ${weekNumber}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days remaining until `iso`, NEGATIVE once it has passed. Floored, not rounded: "how many
 * FULL days are left" is the honest question an expiry line answers, and rounding up would claim
 * a day that has not actually started yet. `now` is a parameter, not `new Date()` read inside, so
 * a test can pin it (fix round 1, F2 — the proposer's own card and the post-propose confirmation
 * both need this, and a real clock cannot be asserted against).
 *
 * The `Math.max(0, …)` clamp this used to carry is gone (final review, HIGH 3): it turned an
 * offer that died three days ago into `0`, which `formatExpiry` then rendered as "Expires today."
 * — actively false copy, not merely stale. A count that can go negative is what lets both
 * functions below tell the truth.
 */
export function daysUntil(iso: string, now: Date): number {
  const remainingMs = new Date(iso).getTime() - now.getTime();
  return Math.floor(remainingMs / MS_PER_DAY);
}

/** "Expires today."/"Expires tomorrow."/"Expires in N days." — the one place a day count
 *  becomes a sentence, so every surface that shows a LIVE offer's expiry (`TradeCard`,
 *  `TradeComposer`'s post-send confirmation) says it identically. A past-due count reads as
 *  expired rather than as today: callers that hold the date use `formatExpired` for the fuller
 *  sentence, and this stays honest for the ones that do not. */
export function formatExpiry(days: number): string {
  if (days < 0) return "Expired.";
  if (days === 0) return "Expires today.";
  if (days === 1) return "Expires tomorrow.";
  return `Expires in ${days} days.`;
}

/** The month and day an offer ran out on — "August 18", never a locale-dependent numeric date a
 *  reader has to decode. */
const EXPIRED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** What a dead offer's own line says: "Expired August 18." — the state AND the day it happened,
 *  which is the difference between a card a manager can reason about and one that lies to them
 *  (final review, HIGH 3). */
export function formatExpired(iso: string): string {
  return `Expired ${EXPIRED_DATE_FORMAT.format(new Date(iso))}.`;
}

/** "August 18" — the same month-and-day format `formatExpired` already renders, exported bare
 *  so a caller can build its own sentence around it (E6: a trade history card names WHEN a
 *  trade was proposed or settled, not only how it stands today). */
export function formatDate(iso: string): string {
  // An unparseable instant renders as NOTHING, never as a crash (found by the flow-remediation
  // battery: `Intl.format` throws `RangeError: Invalid time value` on an invalid Date, and once
  // a history card rendered a date, one bad timestamp took the whole trades page down with it).
  // Every real column here is a database timestamp, so this guard should never fire — which is
  // exactly why it must not be a thrown error when it does.
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return EXPIRED_DATE_FORMAT.format(at);
}

/**
 * Flow analysis C-02 (2026-08-27): "Saturday 12 September, 7:00 PM UTC" — byte-identical to
 * `formatAbsoluteTime` (`@/league/terms.ts`), duplicated here rather than imported for the same
 * reason `invite-landing.tsx`'s own `DEAD_CODE_TEXT` and `league-terms-panel.tsx`'s own
 * `SCORING_LABEL_TERM` duplicate across the client boundary: `@/league` is server-only
 * (`eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`), and `src/league-room/**` is client-boundary
 * code by construction, so a `"use client"` component may never import it as a value.
 *
 * The bug this closes: one league showing two different draft days on one screen —
 * `DraftSchedulePanel`'s own hero used to read the reader's BROWSER-local time with no zone
 * label at all (`toLocaleString`), while the league's terms panel and the invite landing a
 * stranger reads both already rendered `leagueTerms`'s UTC, zone-labelled convention. Two
 * different timezone treatments for the same instant is the defect (finding C-02), not UTC
 * itself — UTC is the convention this product already commits to everywhere it has no per-visitor
 * timezone signal to read (`formatAbsoluteTime`'s own docblock: no timezone beacon exists), so
 * this function joins that convention rather than inventing a third one.
 *
 * ONE IMPLEMENTATION, NOT TWO (2026-09-11 fix round). Every draft-date SURFACE now renders
 * through `absoluteInstant`/`useReaderClock` (`./day-chapters`, `../hooks/use-reader-clock`):
 * the server's UTC words until the reader's own clock resolves, their own zone and locale after.
 * This function is what is left for a caller with no clock to read — the app shell's rail bakes
 * its one line server-side (`railStateLine`, `./rail-line.ts`) and hands the renderer a finished
 * string, so there is no reader to upgrade for. It delegates to `absoluteInstant`'s null branch
 * rather than keeping a second set of formatters that spell the same rule: two copies of one
 * convention is exactly the drift C-02 was.
 */
export function formatDraftAbsolute(iso: string): string {
  // The same guard `formatDate` above carries, for the same reason (flow-remediation review
  // D-2): `Intl` throws `RangeError` on an invalid Date, and absence must render as absence.
  if (Number.isNaN(Date.parse(iso))) return "";
  return absoluteInstant(iso, null);
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });

/** "1st", "2nd", "3rd", "4th" … with the 11th-13th exception — the week strip's standings seat. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  if (ones === 1) return `${n}st`;
  if (ones === 2) return `${n}nd`;
  if (ones === 3) return `${n}rd`;
  return `${n}th`;
}

/** "Friday, 9:00 PM UTC" — a deadline inside the current week (a trade expiry, a waiver clear),
 *  in the product's one timezone convention (`formatDraftAbsolute`'s own reasoning: UTC and
 *  labelled, because no per-visitor timezone signal exists to read). */
export function formatWeekdayClock(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  return `${WEEKDAY_FORMAT.format(instant)}, ${CLOCK_FORMAT.format(instant)} UTC`;
}
