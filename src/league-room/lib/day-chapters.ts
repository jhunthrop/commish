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

/** A stable key for the calendar day an instant landed on, in the reader's own clock. */
export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/**
 * The day, in the words somebody would say out loud. "Today" and "Yesterday" are the two a reader
 * checks for; everything older gets its real name, because "3 days ago" stops being useful the
 * moment a history is more than a week long.
 */
export function dayMarker(iso: string, now: Date): string {
  const day = new Date(iso);
  const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysBack = Math.round((midnight(now) - midnight(day)) / MS_PER_DAY);
  if (daysBack === 0) return "Today";
  if (daysBack === 1) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
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
