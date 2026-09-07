import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { captureSnapshots } from "@/db/schema";

/**
 * THE HARVEST CAPTURES, READ AS A HISTORY (spec `2026-09-07-fact-sheet-depth-design.md` §4, fact 3;
 * inventory rows 3 and 5c).
 *
 * `league-service/injuries.ts` reads the NEWEST `tank01_injuries_by_date` snapshot and stops, which
 * is right for "what is his designation today" and cannot answer "has he been questionable for
 * three straight weeks". This module reads a BOUNDED WINDOW of snapshots instead, oldest first, and
 * hands the rows to a pure collapser.
 *
 * TWO FEEDS, DELIBERATELY, because they carry different halves of the same fact
 * (`projections/capture-feeds.ts` says so itself): `tank01_injuries_by_date` is one cheap request
 * for the whole league's DESIGNATIONS, and `tank01_injuries` is the 32-request roster sweep that
 * "carries descriptions and return dates this list does not". A designation with no description is
 * still a designation, so the cheap feed alone is enough to build a history and the roster sweep
 * only ever ADDS a body part the league published.
 *
 * BOUNDED BY CONSTRUCTION. Every read here takes a `since` instant and a hard row limit, because a
 * daily feed captured for a whole season is hundreds of multi-megabyte payloads and a fact sheet
 * needs the recent shape of one player's status, not the archive.
 *
 * NOTHING IS INFERRED FROM A SHAPE. Every field is read defensively off `unknown` and a payload
 * that does not carry what this module expects yields an EMPTY capture rather than a throw or a
 * guess: a snapshot that failed to parse is a snapshot that says nothing, never one that says
 * everybody is healthy.
 */

/** One player's status in one capture. `description` is the feed's own text, never derived. */
export interface CapturedDesignation {
  readonly designation: string;
  readonly description: string | null;
}

/** One snapshot, flattened: when it was taken, and what it said about each player it named. */
export interface InjuryCapture {
  readonly capturedAt: Date;
  readonly designations: ReadonlyMap<string, CapturedDesignation>;
}

/** One player's biography as the roster sweep publishes it. Every field is `null` when the payload
 *  carried none; nothing here is derived from another field. */
export interface CapturedBio {
  readonly college: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** `tank01_injuries_by_date`: one object with an `injList` of `{ playerID, designation }`. */
function readDesignationList(payload: unknown): ReadonlyMap<string, CapturedDesignation> {
  const list = asRecord(payload).injList;
  const out = new Map<string, CapturedDesignation>();
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const entry = asRecord(raw);
    const playerId = asText(entry.playerID);
    const designation = asText(entry.designation);
    if (playerId !== null && designation !== null) out.set(playerId, { designation, description: null });
  }
  return out;
}

/** `tank01_injuries`: an array of teams, each with a `roster` of players carrying an `injury`
 *  object. A player whose `injury.designation` is empty is NOT named — an empty designation is the
 *  feed saying nothing about him, not the feed clearing him. */
function readRosterSweep(payload: unknown): ReadonlyMap<string, CapturedDesignation> {
  const out = new Map<string, CapturedDesignation>();
  if (!Array.isArray(payload)) return out;
  for (const rawTeam of payload) {
    const roster = asRecord(rawTeam).roster;
    if (!Array.isArray(roster)) continue;
    for (const rawPlayer of roster) {
      const player = asRecord(rawPlayer);
      const playerId = asText(player.playerID);
      const injury = asRecord(player.injury);
      const designation = asText(injury.designation);
      if (playerId !== null && designation !== null) out.set(playerId, { designation, description: asText(injury.description) });
    }
  }
  return out;
}

/** Every college the roster sweep published, keyed by the feed's own player id. */
export function readRosterBios(payload: unknown): ReadonlyMap<string, CapturedBio> {
  const out = new Map<string, CapturedBio>();
  if (!Array.isArray(payload)) return out;
  for (const rawTeam of payload) {
    const roster = asRecord(rawTeam).roster;
    if (!Array.isArray(roster)) continue;
    for (const rawPlayer of roster) {
      const player = asRecord(rawPlayer);
      const playerId = asText(player.playerID);
      if (playerId === null) continue;
      out.set(playerId, { college: asText(player.school) });
    }
  }
  return out;
}

/** The two feeds a designation can come from, in the order a merge prefers them: the roster sweep
 *  last, because it alone carries the body part. */
export const DESIGNATION_SOURCES = ["tank01_injuries_by_date", "tank01_injuries"] as const;

/** Turns one stored snapshot into a capture, whichever of the two feeds it came from. */
export function parseInjuryCapture(source: string, payload: unknown, capturedAt: Date): InjuryCapture {
  const designations = source === "tank01_injuries" ? readRosterSweep(payload) : readDesignationList(payload);
  return { capturedAt, designations };
}

/**
 * Every designation capture at or after `since`, oldest first, capped at `limit` snapshots.
 *
 * ONE READ FOR BOTH FEEDS, `IN (…)` rather than two round trips. `limit` is applied by the database
 * to the NEWEST rows and the result is then put back into oldest-first order in memory, so a season
 * with hundreds of captures still yields the most recent window rather than the oldest one.
 */
export async function injuryCapturesFor(db: ReadonlyDb, since: Date, limit: number): Promise<readonly InjuryCapture[]> {
  const rows = await db
    .select({ source: captureSnapshots.source, payload: captureSnapshots.payload, capturedAt: captureSnapshots.capturedAt })
    .from(captureSnapshots)
    .where(and(inArray(captureSnapshots.source, [...DESIGNATION_SOURCES]), gte(captureSnapshots.capturedAt, since)))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(limit);
  return [...rows]
    .reverse()
    .map((row) => parseInjuryCapture(row.source, row.payload, row.capturedAt));
}

/** The newest roster sweep's biographies, or an empty map when none has been captured yet. One
 *  `LIMIT 1` read, the same shape `injurySnapshot` already uses for its own single snapshot. */
export async function latestRosterBios(db: ReadonlyDb): Promise<ReadonlyMap<string, CapturedBio>> {
  const [row] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_injuries"))
    .orderBy(desc(captureSnapshots.capturedAt), asc(captureSnapshots.id))
    .limit(1);
  return row === undefined ? new Map() : readRosterBios(row.payload);
}
