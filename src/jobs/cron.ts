// CRON, EVALUATED RATHER THAN SOLVED. Schedules live in code as five-field cron expressions with
// an IANA timezone (src/jobs/schedules.ts). This module parses the expression and answers ONE
// question — "does this UTC minute match, seen from that zone?" — via `Intl.DateTimeFormat`, so
// DST is handled by asking each instant what it looks like locally instead of hand-computing
// offsets. Catch-up (`fireInstantsBetween`) is a bounded minute walk over that predicate: for the
// windows this system ever evaluates (a tick's gap, capped at `JOBS_CONFIG.maxCatchUpMs`), a walk
// is thousands of cheap predicate calls, and a next-fire solver would be an optimization with a
// DST bug surface the walk simply does not have. No dependency taken on purpose.
//
// DST edges, pinned by tests rather than left to folklore: a wall-clock minute that occurs twice
// on a fall-back day matches BOTH UTC instants (two fires, distinct fire instants, each its own
// idempotency key), and a minute skipped by spring-forward matches none. The season schedules
// (08:00, 14:00, 18:00) sit nowhere near the 01:00-03:00 edge either way.

interface CronField {
  /** `null` means `*` — unrestricted. Otherwise the exact allowed values. */
  readonly values: ReadonlySet<number> | null;
}

export interface CronExpression {
  readonly minute: CronField;
  readonly hour: CronField;
  readonly dayOfMonth: CronField;
  readonly month: CronField;
  readonly dayOfWeek: CronField;
  /** The five fields as written, kept for error messages and the admin page. */
  readonly source: string;
}

interface FieldSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 }, // 7 folds to 0 (Sunday), vixie-cron style
];

/** Parses five-field cron: `*`, numbers, ranges `a-b`, steps (a slash after `*` or a range),
 *  and comma lists of any of those. Throws with the field name on anything else — a schedule that
 *  cannot parse must fail at module load, not silently never fire. Names (`@weekly`, `MON`) are
 *  not supported: the config is code, and numbers with a comment beat a second parser. */
export function parseCronExpression(source: string): CronExpression {
  const parts = source.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron "${source}": expected 5 fields (minute hour day-of-month month day-of-week), got ${parts.length}.`);
  }
  const fields = parts.map((part, index) => parseField(part, FIELD_SPECS[index]!, source));
  return {
    minute: fields[0]!,
    hour: fields[1]!,
    dayOfMonth: fields[2]!,
    month: fields[3]!,
    dayOfWeek: normalizeDayOfWeek(fields[4]!),
    source: source.trim(),
  };
}

function parseField(part: string, spec: FieldSpec, source: string): CronField {
  if (part === "*") return { values: null };
  const values = new Set<number>();
  for (const piece of part.split(",")) {
    for (const value of parsePiece(piece, spec, source)) values.add(value);
  }
  return { values };
}

function parsePiece(piece: string, spec: FieldSpec, source: string): readonly number[] {
  const match = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(piece);
  if (match === null) throw new Error(`cron "${source}": ${spec.name} piece "${piece}" is not valid.`);
  const [, star, startRaw, endRaw, stepRaw] = match;
  const step = stepRaw === undefined ? 1 : Number(stepRaw);
  if (step < 1) throw new Error(`cron "${source}": ${spec.name} step must be >= 1.`);

  const start = star !== undefined ? spec.min : Number(startRaw);
  const end = star !== undefined ? spec.max : endRaw !== undefined ? Number(endRaw) : start;
  if (start < spec.min || end > spec.max || start > end) {
    throw new Error(`cron "${source}": ${spec.name} range ${start}-${end} is outside ${spec.min}-${spec.max}.`);
  }
  if (star === undefined && endRaw === undefined && stepRaw !== undefined) {
    throw new Error(`cron "${source}": ${spec.name} step needs a range or * before the slash.`);
  }

  const values: number[] = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

/** Vixie cron accepts both 0 and 7 for Sunday; internally everything is 0-6. */
function normalizeDayOfWeek(field: CronField): CronField {
  if (field.values === null) return field;
  return { values: new Set([...field.values].map((value) => (value === 7 ? 0 : value))) };
}

/** What one UTC instant looks like on a wall clock in `timeZone`. */
export interface LocalMinute {
  readonly minute: number;
  readonly hour: number;
  readonly dayOfMonth: number;
  readonly month: number;
  readonly dayOfWeek: number; // 0 = Sunday
}

const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** One formatter per zone, cached — `Intl.DateTimeFormat` construction is the expensive part of
 *  the minute walk, and the zone list is tiny (the schedules' own zones). */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) return cached;
  // Throws on an unknown zone name — exactly the fail-fast a mistyped schedule config needs.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function localMinuteOf(instant: Date, timeZone: string): LocalMinute {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error(`cron: Intl gave no "${type}" part for zone "${timeZone}".`);
    return part.value;
  };
  const weekday = WEEKDAYS[read("weekday")];
  if (weekday === undefined) throw new Error(`cron: unrecognized weekday "${read("weekday")}" for zone "${timeZone}".`);
  return {
    minute: Number(read("minute")),
    hour: Number(read("hour")) % 24, // h23 still yields "24" for midnight in some ICU versions
    dayOfMonth: Number(read("day")),
    month: Number(read("month")),
    dayOfWeek: weekday,
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.values === null || field.values.has(value);
}

/**
 * Does this UTC instant's minute match, seen from `timeZone`? Seconds are the caller's business —
 * the walk only ever asks about minute-aligned instants. Day matching follows vixie cron's one
 * quirk: when BOTH day-of-month and day-of-week are restricted, a day matches if EITHER does;
 * otherwise both (trivially, for the unrestricted one) must.
 */
export function cronMatches(expression: CronExpression, instant: Date, timeZone: string): boolean {
  const local = localMinuteOf(instant, timeZone);
  if (!fieldMatches(expression.minute, local.minute)) return false;
  if (!fieldMatches(expression.hour, local.hour)) return false;
  if (!fieldMatches(expression.month, local.month)) return false;

  const domRestricted = expression.dayOfMonth.values !== null;
  const dowRestricted = expression.dayOfWeek.values !== null;
  const domMatches = fieldMatches(expression.dayOfMonth, local.dayOfMonth);
  const dowMatches = fieldMatches(expression.dayOfWeek, local.dayOfWeek);
  return domRestricted && dowRestricted ? domMatches || dowMatches : domMatches && dowMatches;
}

const MINUTE_MS = 60_000;

/**
 * Every fire instant in `(exclusiveStart, inclusiveEnd]` — the catch-up walk. Instants are
 * minute-aligned UTC (cron fires at second 0). The caller bounds the window
 * (`JOBS_CONFIG.maxCatchUpMs`); this function refuses a reversed one and walks the rest.
 */
export function fireInstantsBetween(
  expression: CronExpression,
  timeZone: string,
  exclusiveStart: Date,
  inclusiveEnd: Date,
): readonly Date[] {
  if (inclusiveEnd.getTime() < exclusiveStart.getTime()) {
    throw new Error(`cron: fire window end ${inclusiveEnd.toISOString()} is before start ${exclusiveStart.toISOString()}.`);
  }
  const firstMinute = Math.floor(exclusiveStart.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const fires: Date[] = [];
  for (let at = firstMinute; at <= inclusiveEnd.getTime(); at += MINUTE_MS) {
    const instant = new Date(at);
    if (cronMatches(expression, instant, timeZone)) fires.push(instant);
  }
  return fires;
}
