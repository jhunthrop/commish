/**
 * THE PICK-PATH TIMERS (draft-room performance round, 2026-09-19): one opt-in stopwatch around
 * each stage a pick passes through on the server — the advance that lands it, the publish that
 * relays it, the room facts computed after it — so a measurement run can read every stage's
 * wall time off the server log instead of inferring it from Postgres and Redis captures.
 *
 * OFF UNLESS ASKED. `DRAFT_PICK_PATH_TIMING=1` turns the sink on; otherwise `time` is the work
 * itself and nothing is formatted. The line is a fixed prefix followed by one JSON object, so a
 * harness parses it with one `indexOf` and never a regex over prose: `at` is the stage's START
 * instant (ISO), `ms` its wall time from `performance.now()`, and `fields` whatever the caller
 * named (a draft id, a sequence, how late a timer fired). A stage that throws logs nothing: the
 * error is the caller's to report, and a half-timed line would only mislead a reader.
 */
import { performance } from "node:perf_hooks";

export const PICK_PATH_PREFIX = "[draft] pick-path ";

export type PickPathFields = Readonly<Record<string, string | number | boolean | null>>;

export interface PickPathTimer {
  readonly enabled: boolean;
  /** Runs `work`, logging one line when enabled. `fields` may be built from the result. */
  time<T>(label: string, work: () => Promise<T>, fields?: PickPathFields | ((result: T) => PickPathFields)): Promise<T>;
  /** One line with no work behind it: an instant worth marking (a timer firing late). */
  mark(label: string, fields?: PickPathFields): void;
}

export interface PickPathTimerDeps {
  readonly enabled: boolean;
  /** Where lines go. Defaults to `console.info`; a test hands in an array push. */
  readonly sink?: (line: string) => void;
  readonly now?: () => number;
  readonly wallClock?: () => string;
}

/** What one enabled line carries, before the caller's fields are spread over it. */
interface PickPathLine extends PickPathFields {
  readonly label: string;
  readonly at: string;
  readonly ms: number;
}

/** A timer that does no work at all: what every disabled process holds. */
const OFF: PickPathTimer = {
  enabled: false,
  time: (_label, work) => work(),
  mark: () => undefined,
};

export function createPickPathTimer({ enabled, sink = (line) => console.info(line), now = () => performance.now(), wallClock = () => new Date().toISOString() }: PickPathTimerDeps): PickPathTimer {
  if (!enabled) return OFF;
  const emit = (line: PickPathLine): void => sink(`${PICK_PATH_PREFIX}${JSON.stringify(line)}`);
  return {
    enabled: true,
    async time(label, work, fields) {
      const at = wallClock();
      const started = now();
      const result = await work();
      const named = typeof fields === "function" ? fields(result) : (fields ?? {});
      emit({ ...named, label, at, ms: round(now() - started) });
      return result;
    },
    mark(label, fields = {}) {
      emit({ ...fields, label, at: wallClock(), ms: 0 });
    },
  };
}

/** Tenths of a millisecond: enough to read a 3 ms publish, never a float's whole tail. */
const round = (ms: number): number => Math.round(ms * 10) / 10;

/** Parses one sink line back into its object; `null` for any line that is not a pick-path line. */
export function parsePickPathLine(line: string): (PickPathFields & { readonly label: string; readonly at: string; readonly ms: number }) | null {
  const start = line.indexOf(PICK_PATH_PREFIX);
  if (start < 0) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(start + PICK_PATH_PREFIX.length));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.label !== "string" || typeof record.at !== "string" || typeof record.ms !== "number") return null;
    return record as PickPathFields & { readonly label: string; readonly at: string; readonly ms: number };
  } catch {
    return null;
  }
}

/** The process-wide timer, read once at load from the env flag. */
export const pickPath: PickPathTimer = createPickPathTimer({ enabled: process.env.DRAFT_PICK_PATH_TIMING === "1" });
