/** Display only. Every number here was already computed and rounded on the server. */
export function formatRecord({ wins, losses, ties }: { readonly wins: number; readonly losses: number; readonly ties: number }): string {
  return ties === 0 ? `${wins}-${losses}` : `${wins}-${losses}-${ties}`;
}

export function formatPoints(points: number): string {
  return points.toFixed(2);
}

/**
 * ONE DECIMAL, ALWAYS (dossier-voice round §3.4, founder: "up 12.440000000000001").
 *
 * A number that reaches a sentence through a subtraction carries the whole of binary floating
 * point with it, and a module that interpolates it raw prints all seventeen digits of it. Every
 * per-game figure and every delta on a dossier module goes through this: "12.4", "3.0", "-1.8".
 */
export function formatTenth(value: number): string {
  return value.toFixed(1);
}

/**
 * A BOOK'S OWN LINE — one decimal, with a bare `.0` trimmed: a win total of 9.5 is 9.5 and a win
 * total of 10 is 10, never "10.0". The books post halves, so the half has to survive, and a whole
 * number nobody hung a half on should not grow a decimal it never had.
 */
export function formatLine(value: number): string {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A counted quantity a person says whole: yards, snaps, attempts. */
export function formatWhole(value: number): string {
  return String(Math.round(value));
}

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
 * this function joins that convention rather than inventing a third one. `DraftSchedulePanel`'s
 * own hero (`../components/draft-schedule-panel.tsx`) is this function's one caller.
 */
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" });
const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });

export function formatDraftAbsolute(iso: string): string {
  const instant = new Date(iso);
  // The same guard `formatDate` above carries, for the same reason (flow-remediation review
  // D-2): four `Intl.format` calls on an invalid Date throw `RangeError`, and this one feeds
  // the more prominent surface of the two.
  if (Number.isNaN(instant.getTime())) return "";
  return `${WEEKDAY_FORMAT.format(instant)} ${DAY_FORMAT.format(instant)} ${MONTH_FORMAT.format(instant)}, ${CLOCK_FORMAT.format(instant)} UTC`;
}

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
