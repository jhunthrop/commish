/**
 * Day chapters for a stream that arrives newest first or oldest first: the day is a chapter
 * marker carrying its own count, and each row keeps only the clock. Shared by the activity
 * feed and the front page's stream, so "Today" is decided once.
 */
export interface Dated {
  readonly occurredAt: string;
}

export interface DayChapter<T extends Dated> {
  readonly key: string;
  readonly rows: readonly T[];
}

const MS_PER_DAY = 86_400_000;

/**
 * THE READER'S OWN CLOCK, passed in rather than read.
 *
 * `dayMarker` used to call `new Date()` and `toLocaleDateString(undefined, …)` at render, which
 * made its output a function of three things nobody passed it: the wall clock at the instant React
 * happened to draw, the locale the environment happened to resolve, and the TIME ZONE it happened
 * to sit in. On the server all three are the server's, on the client they are the browser's, and
 * the two disagree — so an activity feed rendered at 23:59 UTC could print "Today" over rows the
 * reader's own Tuesday had not started yet, and a test's expected string depended on where it ran.
 *
 * THE ZONE IS THE ONE THE FIRST PASS MISSED (the whole-branch review, H4). Pinning the locale
 * without pinning the zone left the same class of mismatch on the same render: 06:00 UTC on the
 * 11th is 23:00 on the 10th in Los Angeles, so a UTC server drew "Friday, September 11" where a
 * Pacific client drew "Thursday, September 10", and `byDay` split the chapters differently too,
 * which is a DOM SHAPE mismatch rather than a text one. Every function in this file now takes the
 * zone it is to resolve in, and none of them reads an ambient one.
 *
 * `null` is a real and deliberate state, not an absence to paper over: it means "nothing has told
 * this render whose clock it is", and the marker answers with the day's own absolute name in
 * `FALLBACK_LOCALE` and `FALLBACK_TIME_ZONE` rather than a relative word it cannot justify. A
 * client surface resolves the reader's real clock after mount (`useReaderClock`) and the relative
 * words arrive with it; a server-rendered surface keeps the absolute names in UTC, which for a
 * history log is the more useful register anyway.
 */
export interface ReaderClock {
  /** Epoch milliseconds, from the reader's own device. */
  readonly nowMs: number;
  /** A BCP 47 tag, from the reader's own browser. Never `undefined`: an implicit locale is the
   *  same non-determinism as an implicit clock. */
  readonly locale: string;
  /** An IANA zone, from the reader's own browser. Never `undefined`, for the same reason. */
  readonly timeZone: string;
}

/**
 * The locale a render falls back to when nobody has told it the reader's. Fixed on purpose: a
 * constant produces the same string everywhere, which is what makes the server render and the
 * client's first render agree byte for byte.
 */
export const FALLBACK_LOCALE = "en-US";

/** The zone a render falls back to, for the same reason. UTC, because a server has no reader to
 *  borrow a zone from and any local guess would be one machine's accident. */
export const FALLBACK_TIME_ZONE = "UTC";

/** One `Intl.DateTimeFormat` per zone rather than one per call: a stream of forty rows would
 *  otherwise construct forty formatters to answer the same question. */
const DAY_PARTS = new Map<string, Intl.DateTimeFormat>();

function dayPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = DAY_PARTS.get(timeZone);
  if (cached !== undefined) return cached;
  // `en-US` and not the reader's locale: these parts are arithmetic inputs and a chapter KEY, never
  // anything printed, so they must not change shape with a locale. The reader's own locale is
  // spent on `absoluteDay`, which is the only thing here a person reads.
  const made = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  DAY_PARTS.set(timeZone, made);
  return made;
}

/** The calendar day an instant fell on IN A STATED ZONE, as a sortable, printable key. */
function civilDay(iso: string, timeZone: string): { readonly year: number; readonly month: number; readonly day: number } {
  const parts = dayPartsFormatter(timeZone).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** A stable key for the calendar day an instant landed on, in the stated zone: "2026-09-11". */
export function dayKey(iso: string, timeZone: string): string {
  const { year, month, day } = civilDay(iso, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The day's own name in the stated locale and zone, with no claim about how long ago it was. */
function absoluteDay(iso: string, locale: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString(locale, { timeZone, weekday: "long", month: "long", day: "numeric" });
}

/** One `Intl.DateTimeFormat` per (locale, zone) pair — mirrors `dayPartsFormatter`'s cache, for
 *  a shelf whose head reads `absoluteInstant` once per render rather than minting a formatter
 *  each time. */
const ABSOLUTE_INSTANT_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function absoluteInstantFormatter(locale: string, timeZone: string): Intl.DateTimeFormat {
  const key = `${locale} ${timeZone}`;
  const cached = ABSOLUTE_INSTANT_FORMATTERS.get(key);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    timeZone,
  });
  ABSOLUTE_INSTANT_FORMATTERS.set(key, made);
  return made;
}

/**
 * "Saturday 12 September, 7:00 PM UTC" — the day AND the clock, in the reader's own zone and
 * locale once `useReaderClock` resolves them, and in the identical fixed shape
 * (`FALLBACK_LOCALE`/`FALLBACK_TIME_ZONE`) before it does. The front door's "Seat counts as of
 * {…}" line (`seatCountsAsOfSentence`, `../components/public-league-list.tsx`) used to always
 * render `@/league`'s UTC-fixed `formatAbsoluteTime` — honest on the server render, where there
 * is no visitor to read a zone from, but wrong FOREVER on the client, where a real zone has been
 * sitting in the browser the whole time. `null` renders the exact words `formatAbsoluteTime`
 * would (same locale, same zone), so the server pass and the client's first (hydrating) render
 * agree byte for byte — only the effect that resolves the reader's own clock ever changes what
 * this prints, the same hydration-safe contract `dayMarker` above already holds.
 *
 * Built from `formatToParts` rather than `formatAbsoluteTime`'s four separate formatters: the
 * zone name is no longer the fixed literal "UTC", so it has to be READ off the formatter
 * (`timeZoneName: "short"`) rather than appended.
 */
export function absoluteInstant(iso: string, clock: ReaderClock | null): string {
  const locale = clock?.locale ?? FALLBACK_LOCALE;
  const timeZone = clock?.timeZone ?? FALLBACK_TIME_ZONE;
  const parts = absoluteInstantFormatter(locale, timeZone).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("weekday")} ${value("day")} ${value("month")}, ${value("hour")}:${value("minute")} ${value("dayPeriod")} ${value("timeZoneName")}`;
}

/** Midnight of a civil day as a UTC instant, so two civil days can be subtracted without either
 *  one's own offset (or a daylight-saving jump inside it) reaching the arithmetic. */
function civilMidnightMs(iso: string, timeZone: string): number {
  const { year, month, day } = civilDay(iso, timeZone);
  return Date.UTC(year, month - 1, day);
}

/**
 * The day, in the words somebody would say out loud. "Today" and "Yesterday" are the two a reader
 * checks for; everything older gets its real name, because "3 days ago" stops being useful the
 * moment a history is more than a week long.
 *
 * Pure in all three of its inputs: the same `iso` and the same `clock` produce the same string on
 * any machine in any zone, which is the whole point of taking them rather than reading them.
 */
export function dayMarker(iso: string, clock: ReaderClock | null): string {
  if (clock === null) return absoluteDay(iso, FALLBACK_LOCALE, FALLBACK_TIME_ZONE);
  const daysBack = Math.round(
    (civilMidnightMs(new Date(clock.nowMs).toISOString(), clock.timeZone) - civilMidnightMs(iso, clock.timeZone)) / MS_PER_DAY,
  );
  if (daysBack === 0) return "Today";
  if (daysBack === 1) return "Yesterday";
  return absoluteDay(iso, clock.locale, clock.timeZone);
}

/** The rows split into one chapter per calendar day IN THE STATED ZONE, in the order they arrive:
 *  a day boundary is simply where two adjacent rows stop agreeing about the date. A fold, never a
 *  sort. The zone is an argument for the same reason `dayMarker` takes one — two runtimes that
 *  disagree about which day an instant fell on also disagree about how many chapters there are. */
export function byDay<T extends Dated>(rows: readonly T[], timeZone: string): readonly DayChapter<T>[] {
  return rows.reduce<readonly DayChapter<T>[]>((chapters, row) => {
    const key = dayKey(row.occurredAt, timeZone);
    const last = chapters[chapters.length - 1];
    if (last !== undefined && last.key === key) {
      return [...chapters.slice(0, -1), { key, rows: [...last.rows, row] }];
    }
    return [...chapters, { key, rows: [row] }];
  }, []);
}
