import { parseOddsEvent, type OddsEvent } from "./http";

/**
 * THE HISTORICAL API'S OWN RESPONSE WRAPPER — `{ timestamp, previous_timestamp, next_timestamp,
 * data }` — verified live against both historical endpoints this backfill uses
 * (`/historical/.../events` and `/historical/.../events/{id}/odds`). Neither the live snapshot
 * script nor `props-store.ts` has ever seen this shape; `data` is the SAME event-odds object
 * `parseEventOddsResponse` already parses (`props-store.ts`), and the wrapper's own `timestamp` is
 * the ARCHIVE INSTANT — the API's own record of when it actually captured this snapshot, which is
 * never exactly the `date` query parameter a caller asked for (the API returns the closest snapshot
 * AT OR BEFORE that moment). This is why `fetched_at` is stamped from `timestamp`, never from the
 * requested date and never from wall-clock `new Date()` — see the task brief's own API facts.
 */

export interface HistoricalEventsPage {
  readonly timestamp: Date;
  readonly events: readonly OddsEvent[];
}

function requireDate(value: unknown, path: string): Date {
  if (typeof value !== "string") throw new Error(`${path} is missing.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${path} is unparseable ("${value}").`);
  return parsed;
}

/** Parses `/historical/.../events`'s wrapper: `timestamp` plus the bare event list under `data`. */
export function parseHistoricalEventsPage(payload: unknown): HistoricalEventsPage {
  if (typeof payload !== "object" || payload === null) throw new Error("historical /events response was not an object.");
  const root = payload as Record<string, unknown>;
  const timestamp = requireDate(root.timestamp, "historical /events response.timestamp");
  if (!Array.isArray(root.data)) throw new Error("historical /events response.data was not an array.");
  const events = root.data.map((raw, index) => parseOddsEvent(raw, `historical /events response.data[${index}]`));
  return { timestamp, events };
}

export interface HistoricalEventOddsPage {
  readonly timestamp: Date;
  /** The raw event-odds object under `data` -- passed straight to `parseEventOddsResponse`
   *  (`props-store.ts`), which already validates its own shape. Not re-validated here, so this
   *  wrapper stays a thin unwrap rather than a second copy of that parser. */
  readonly data: unknown;
}

/** Parses `/historical/.../events/{id}/odds`'s wrapper: `timestamp` plus the event-odds object
 *  under `data`, UNVALIDATED -- `parseEventOddsResponse` owns validating `data`'s own shape. */
export function parseHistoricalEventOddsPage(payload: unknown): HistoricalEventOddsPage {
  if (typeof payload !== "object" || payload === null) throw new Error("historical event-odds response was not an object.");
  const root = payload as Record<string, unknown>;
  const timestamp = requireDate(root.timestamp, "historical event-odds response.timestamp");
  return { timestamp, data: root.data };
}
