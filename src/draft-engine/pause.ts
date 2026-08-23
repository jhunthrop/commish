import { MS_PER_SECOND, SECONDS_PER_HOUR } from "@/domain/duration";
import type { PauseWindow } from "./config";

export type { PauseWindow } from "./config";

/**
 * The overnight pause, in one file: given a window and an instant, how much of a stretch of
 * time landed inside it, and where a deadline lands once every overlap is added back.
 *
 * REDUCER PURITY (the plan's ruling, Task 3.5.4). Nothing here is ever imported by `reduce.ts`,
 * `snake.ts`, `auction.ts` or `apply-pick.ts` — `flag-only.test.ts`-style, a source-level
 * assertion below proves it, not a comment trusted on its own. The pause is applied where a
 * deadline is COMPUTED (`selectors.ts`, at read time), never inside the replay-deterministic
 * state machine: a persisted `TIMER_EXPIRE` must decode the same way forever, and a deploy that
 * moved `DRAFT_PAUSE_WINDOW` must never turn an old, already-accepted expiry into a different
 * outcome on replay — the exact failure `admit.ts`'s own docblock already records for the 60s
 * to 90s clock-floor change. This is the deliberate ASYMMETRY with Task 5's skip policy, which
 * DOES snapshot into `START_DRAFT`: a skip changes what the reducer itself must decide (who is
 * skipped), so it has to ride the log: a pause changes only when a deadline that already exists
 * is read as having arrived, so it never touches the log at all.
 */

const MS_PER_MINUTE = MS_PER_SECOND * 60;
export const MS_PER_HOUR = MS_PER_SECOND * SECONDS_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * 24;

/** How many fixpoint passes `deadlineAfter` may take before it gives up. A real window (a few
 *  hours, once a night) converges in 2-4; only a misconfigured window (one covering nearly the
 *  whole day, so a clock can never escape it) would ever approach this. */
const FIXPOINT_ITERATION_CEILING = 1_000;

function parseIso(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Expected an ISO timestamp for ${label}, got "${value}".`);
  return ms;
}

/**
 * The UTC offset (minutes EAST of UTC — negative west, e.g. -240 for EDT) in effect for `zone`
 * at `instantMs`. The one platform API this whole module leans on: `Intl.DateTimeFormat`'s
 * `shortOffset`, a built-in present in Node 20+ and every target browser, needing no dependency
 * and no tz database of our own. Reads the offset AT AN INSTANT, never the host's own zone —
 * which is what lets this run under any `TZ` and get the same answer.
 */
function zoneOffsetMinutes(instantMs: number, zone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(new Date(instantMs))
    .find((p) => p.type === "timeZoneName")!.value;
  // Every valid IANA zone's `shortOffset` matches this shape — bare "GMT" (zone "UTC" itself),
  // "GMT+9"/"GMT-4" (a whole-hour offset), or "GMT+5:30" (a fractional one, e.g. India) — so a
  // non-match here would mean `formatToParts` stopped honoring its own documented output shape,
  // not a case this module's callers can ever produce. Asserted with `!` rather than a runtime
  // branch this suite could never otherwise exercise (the same discipline `test-support.ts`'s
  // `expireAt` uses).
  const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(part)!;
  const [, sign, hours, minutes] = match;
  if (hours === undefined) return 0;
  const magnitude = Number(hours) * 60 + (minutes === undefined ? 0 : Number(minutes));
  return sign === "-" ? -magnitude : magnitude;
}

interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The calendar date `instantMs` falls on IN `zone` — never the host's own zone. */
function localDateAt(instantMs: number, zone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(
    new Date(instantMs),
  );
  const get = (type: string): number => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** `date` plus `days` calendar days, correct across a month or year boundary — arithmetic on
 *  the CALENDAR (via `Date.UTC`'s own overflow normalization), never on real elapsed
 *  milliseconds, so it can never be off by an hour across a DST transition. */
function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/**
 * `date`'s local wall-clock `hour:00` IN `zone`, as a UTC instant — the standard two-pass
 * correction: guess at the local wall time AS IF it were UTC, correct once by the offset AT
 * that guess, then correct once more by the offset at the CORRECTED instant. The second pass is
 * what resolves a DST transition correctly rather than by luck:
 *
 * - Ordinary hour (no nearby transition): both offsets agree, so the second pass is a no-op —
 *   `off3 === off2` on the first try, and this returns the once-corrected instant.
 * - Fall back (the hour before a repeated hour, e.g. 2 AM ET on 1 November): the first pass
 *   guesses with the PRE-transition offset and lands the far side of the transition, where the
 *   POST-transition offset applies; correcting again with THAT offset converges — `off3 === off2`
 *   — on the instant after the repeat.
 * - Spring forward (an hour that never happens, e.g. 2 AM ET on 8 March): the two offsets keep
 *   disagreeing no matter how many more passes run (`off3 !== off2`), which is the signature of
 *   a genuine gap — this returns the FIRST correction, which lands on the instant local clocks
 *   actually read the moment they spring forward (3 AM, not 1 AM), the same skip-the-gap
 *   convention every timezone library uses.
 */
function zonedHourToUtcMs(date: LocalDate, hour: number, zone: string): number {
  const guessMs = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0, 0);
  const off1 = zoneOffsetMinutes(guessMs, zone);
  const u1 = guessMs - off1 * MS_PER_MINUTE;
  const off2 = zoneOffsetMinutes(u1, zone);
  const u2 = guessMs - off2 * MS_PER_MINUTE;
  const off3 = zoneOffsetMinutes(u2, zone);
  return off3 === off2 ? u2 : u1;
}

/** `window`'s UTC bounds for the occurrence that starts on local calendar `date`. */
function windowBoundsForDate(date: LocalDate, window: PauseWindow): { readonly startMs: number; readonly endMs: number } {
  return { startMs: zonedHourToUtcMs(date, window.startHour, window.zone), endMs: zonedHourToUtcMs(date, window.endHour, window.zone) };
}

/**
 * Total milliseconds of `[fromIso, toIso)` that fall inside an occurrence of `window` — summed
 * across every local calendar date the range touches, since a range longer than a day (an
 * 8-hour pick clock, say) can only ever reach ONE window a night, but the range itself may span
 * several nights. Zero for an empty or backwards range, which lets `deadlineAfter` call this
 * with a not-yet-converged candidate without a separate guard.
 */
export function pausedMillisBetween(fromIso: string, toIso: string, window: PauseWindow): number {
  const fromMs = parseIso(fromIso, "the range's start");
  const toMs = parseIso(toIso, "the range's end");
  if (toMs <= fromMs) return 0;

  const fromDate = localDateAt(fromMs, window.zone);
  const toDate = localDateAt(toMs, window.zone);
  const dayCount = Math.round((Date.UTC(toDate.year, toDate.month - 1, toDate.day) - Date.UTC(fromDate.year, fromDate.month - 1, fromDate.day)) / MS_PER_DAY) + 1;

  let total = 0;
  for (let i = 0; i < dayCount; i++) {
    const { startMs, endMs } = windowBoundsForDate(addDays(fromDate, i), window);
    const overlapStart = Math.max(fromMs, startMs);
    const overlapEnd = Math.min(toMs, endMs);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }
  return total;
}

/**
 * The window's end instant if `atIso` falls inside an occurrence of it, else null — "if we
 * looked at the clock right now, would we see the freeze, and when does it lift." Assumes
 * `window.startHour < window.endHour` (true of `DRAFT_PAUSE_WINDOW`, and every window this
 * module has ever been asked to compute against): a window that crosses local midnight would
 * need to check the adjacent calendar date too, which nothing here does.
 */
export function pausedUntil(atIso: string, window: PauseWindow): string | null {
  const atMs = parseIso(atIso, "the instant");
  const { startMs, endMs } = windowBoundsForDate(localDateAt(atMs, window.zone), window);
  return atMs >= startMs && atMs < endMs ? new Date(endMs).toISOString() : null;
}

/**
 * The deadline for a clock of `seconds` starting at `startIso`, extended past every occurrence
 * of `window` it would otherwise run through. A FIXPOINT, not one addition: adding the paused
 * time can push the candidate deadline INTO more paused time (a clock that starts mid-freeze, or
 * one long enough to reach a second night), so the overlap is recomputed against the moved
 * candidate until it stops moving — bounded by `FIXPOINT_ITERATION_CEILING` so a misconfigured
 * window (one covering nearly the whole day) throws instead of spinning forever.
 */
export function deadlineAfter(startIso: string, seconds: number, window: PauseWindow): string {
  const startMs = parseIso(startIso, "the clock's start");
  const bareMs = startMs + seconds * MS_PER_SECOND;
  let candidateMs = bareMs;
  for (let iteration = 0; iteration < FIXPOINT_ITERATION_CEILING; iteration++) {
    const pausedMs = pausedMillisBetween(startIso, new Date(candidateMs).toISOString(), window);
    const nextMs = bareMs + pausedMs;
    if (nextMs === candidateMs) return new Date(candidateMs).toISOString();
    candidateMs = nextMs;
  }
  throw new Error(
    `deadlineAfter did not converge within ${FIXPOINT_ITERATION_CEILING} iterations for window ${JSON.stringify(window)} — it likely covers nearly the entire day, so a clock can never escape it.`,
  );
}
