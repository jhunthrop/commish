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
 * made its output a function of two things nobody passed it: the wall clock at the instant React
 * happened to draw, and whatever locale the environment happened to resolve. On the server those
 * are the SERVER's, on the client they are the browser's, and the two disagree by a time zone and
 * a locale — so an activity feed rendered at 23:59 UTC could print "Today" over rows the reader's
 * own Tuesday had not started yet, and a test's expected string depended on where it ran.
 *
 * Both inputs are now arguments. `null` is a real and deliberate state, not an absence to paper
 * over: it means "nothing has told this render whose clock it is", and the marker answers with the
 * day's own absolute name in `FALLBACK_LOCALE` rather than a relative word it cannot justify. A
 * client surface resolves the reader's real clock after mount (`useReaderClock`) and the relative
 * words arrive with it; a server-rendered surface simply keeps the absolute names, which for a
 * history log is the more useful register anyway.
 */
export interface ReaderClock {
  /** Epoch milliseconds, from the reader's own device. */
  readonly nowMs: number;
  /** A BCP 47 tag, from the reader's own browser. Never `undefined`: an implicit locale is the
   *  same non-determinism as an implicit clock. */
  readonly locale: string;
}

/**
 * The locale a render falls back to when nobody has told it the reader's. Fixed on purpose: a
 * constant produces the same string everywhere, which is what makes the server render and the
 * client's first render agree byte for byte.
 */
export const FALLBACK_LOCALE = "en-US";

/** A stable key for the calendar day an instant landed on. */
export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/** The day's own name, with no claim about how long ago it was. */
function absoluteDay(day: Date, locale: string): string {
  return day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
}

/**
 * The day, in the words somebody would say out loud. "Today" and "Yesterday" are the two a reader
 * checks for; everything older gets its real name, because "3 days ago" stops being useful the
 * moment a history is more than a week long.
 *
 * Pure in both arguments: the same `iso` and the same `clock` produce the same string on any
 * machine, which is the whole point of taking the clock rather than reading one.
 */
export function dayMarker(iso: string, clock: ReaderClock | null): string {
  const day = new Date(iso);
  if (clock === null) return absoluteDay(day, FALLBACK_LOCALE);
  const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysBack = Math.round((midnight(new Date(clock.nowMs)) - midnight(day)) / MS_PER_DAY);
  if (daysBack === 0) return "Today";
  if (daysBack === 1) return "Yesterday";
  return absoluteDay(day, clock.locale);
}

/** The rows split into one chapter per calendar day, in the order they arrive: a day boundary is
 *  simply where two adjacent rows stop agreeing about the date. A fold, never a sort. */
export function byDay<T extends Dated>(rows: readonly T[]): readonly DayChapter<T>[] {
  return rows.reduce<readonly DayChapter<T>[]>((chapters, row) => {
    const key = dayKey(row.occurredAt);
    const last = chapters[chapters.length - 1];
    if (last !== undefined && last.key === key) {
      return [...chapters.slice(0, -1), { key, rows: [...last.rows, row] }];
    }
    return [...chapters, { key, rows: [row] }];
  }, []);
}
