import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { captureSnapshots, nflPlayers, nflverseInjuries, nflverseRosterWeeks, playerCrosswalk } from "@/db/schema";
import { UNAVAILABLE_REPORT_STATUSES } from "../availability/week-classification";
import {
  currentStatusFromTank01,
  readActiveRosterSweep,
  readPlayerListings,
  rosterStatusFromNflverseRow,
  sweepIsComplete,
  type CurrentRosterStatus,
  type RosterSweepCapture,
  type SweepPhase,
  type Tank01Listing,
} from "./roster-status";

/**
 * THE STORE READS BEHIND A PLAYER'S CURRENT STATUS — one reader per source, each bounded by the
 * caller's `playerIds` and dated by the source itself (the depth chart's is `depth-read.ts`, beside
 * the ordering read of the same rows). `current-status.ts` owns the PRECEDENCE between them (the
 * one resolution both the board's gate and the availability model call); this module owns nothing
 * but the reads, so a new source is one function here and one line there.
 *
 * IDENTITY. The captures key on Tank01's own id, which is the ESPN id; the board keys on the gsis
 * id. `nflPlayers.espnId` resolves most of the board (544 of 546 on the 2026 board when this was
 * built) and `player_crosswalk` resolves a further few through the product's own player row; both
 * are tried, and a player neither resolves is simply not matched to a capture — the week-one row
 * and the depth chart, which already key on the gsis id, still speak for him.
 *
 * THE WEEK-ONE ROW'S DATE IS THE CALLER'S CLAIM. `nflverse_roster_weeks` archives the code with no
 * stamp of its own, and this module will not invent one: `stampedAt` is the date the roster ingest
 * already asserts for the same file (`preseason_rosters.as_of`, the cutdown), passed in so the two
 * readers of one file can never disagree about when it was knowable.
 *
 * BOUNDED. Every read takes `playerIds`; the two captures are one `LIMIT 1` row each.
 */

/** What the sweep the read leaned on actually covered, for the caller's own summary line. */
export interface SweepCoverage {
  readonly capturedAt: Date;
  readonly clubCount: number;
  readonly smallestClub: number | null;
  readonly complete: boolean;
}

interface Capture {
  readonly capturedAt: Date;
  readonly payload: unknown;
}

const SWEEP_FEED = "tank01_injuries";
const PLAYER_LIST_FEED = "tank01_player_list";
const WEEK_ONE = 1;

async function newestCaptureAtOrBefore(db: ReadonlyDb, source: string, asOf: Date): Promise<Capture | null> {
  const [row] = await db
    .select({ capturedAt: captureSnapshots.capturedAt, payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(and(eq(captureSnapshots.source, source), lte(captureSnapshots.capturedAt, asOf)))
    .orderBy(desc(captureSnapshots.capturedAt), desc(captureSnapshots.id))
    .limit(1);
  return row ?? null;
}

/** Every Tank01 id a gsis id may be known by: the universe's ESPN id first, the crosswalk's second. */
export async function tank01IdsFor(db: ReadonlyDb, playerIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
  const [universe, crosswalk] = await Promise.all([
    db.select({ id: nflPlayers.id, espnId: nflPlayers.espnId }).from(nflPlayers).where(inArray(nflPlayers.id, [...playerIds])),
    db
      .select({ nflPlayerId: playerCrosswalk.nflPlayerId, playerId: playerCrosswalk.playerId })
      .from(playerCrosswalk)
      .where(inArray(playerCrosswalk.nflPlayerId, [...playerIds])),
  ]);
  const out = new Map<string, string[]>();
  for (const row of universe) if (row.espnId !== null) out.set(row.id, [row.espnId]);
  for (const row of crosswalk) {
    if (row.nflPlayerId === null) continue;
    const held = out.get(row.nflPlayerId) ?? [];
    if (!held.includes(row.playerId)) out.set(row.nflPlayerId, [...held, row.playerId]);
  }
  return out;
}

export interface HarvestReads {
  readonly sweep: RosterSweepCapture | null;
  readonly listings: ReadonlyMap<string, Tank01Listing>;
  readonly listAt: Date | null;
}

/** The newest roster sweep and player list at or before `asOf`, parsed, the sweep judged for
 *  completeness against the phase's floor. */
export async function harvestReads(db: ReadonlyDb, asOf: Date, phase: SweepPhase): Promise<HarvestReads> {
  const [sweepCapture, listCapture] = await Promise.all([newestCaptureAtOrBefore(db, SWEEP_FEED, asOf), newestCaptureAtOrBefore(db, PLAYER_LIST_FEED, asOf)]);
  const membership = sweepCapture === null ? null : readActiveRosterSweep(sweepCapture.payload);
  return {
    sweep:
      sweepCapture === null || membership === null
        ? null
        : { capturedAt: sweepCapture.capturedAt, ...membership, complete: sweepIsComplete(membership, phase) },
    listings: listCapture === null ? new Map() : readPlayerListings(listCapture.payload),
    listAt: listCapture?.capturedAt ?? null,
  };
}

export function coverageOf(sweep: RosterSweepCapture | null): SweepCoverage | null {
  return sweep === null ? null : { capturedAt: sweep.capturedAt, clubCount: sweep.clubCount, smallestClub: sweep.smallestClub, complete: sweep.complete };
}

/** The harvest's word on one player, tried under each Tank01 id he is known by. */
export function harvestStatusFor(tank01Ids: readonly string[], harvest: HarvestReads): CurrentRosterStatus | null {
  for (const espnId of tank01Ids) {
    const status = currentStatusFromTank01({ espnId, sweep: harvest.sweep, listing: harvest.listings.get(espnId) ?? null, listAt: harvest.listAt });
    if (status !== null) return status;
  }
  return null;
}

/** The season's week-one roster code and detail per player, stamped with the caller's claim. */
export async function weekOneStatuses(db: ReadonlyDb, season: number, playerIds: readonly string[], stampedAt: Date): Promise<ReadonlyMap<string, CurrentRosterStatus>> {
  const rows = await db
    .select({ playerId: nflverseRosterWeeks.playerId, team: nflverseRosterWeeks.team, status: nflverseRosterWeeks.status, statusDetail: nflverseRosterWeeks.statusDetail })
    .from(nflverseRosterWeeks)
    .where(and(eq(nflverseRosterWeeks.season, season), eq(nflverseRosterWeeks.week, WEEK_ONE), inArray(nflverseRosterWeeks.playerId, [...playerIds])));
  const out = new Map<string, CurrentRosterStatus>();
  for (const row of rows) {
    const read = rosterStatusFromNflverseRow(row.status, row.statusDetail);
    if (read !== null) out.set(row.playerId, { kind: read.kind, source: "nflverse_roster_week_1", observedAt: stampedAt, team: row.team, detail: read.detail });
  }
  return out;
}

/**
 * Who the week-one injury report ruled OUT by `asOf`, dated by the report's own `date_modified`:
 * a row the file left undated is not read at all, because an undated claim about week one cannot
 * be placed before or after the moment (2025's file carries no stamp; 2021-2024's do, every row).
 * The designation words are `week-classification.ts`'s own unavailable set, so a reader of the
 * archive and a reader of the current report cannot disagree about what "ruled out" means.
 */
export async function weekOneOutReportsAsOf(db: ReadonlyDb, season: number, asOf: Date, playerIds: readonly string[]): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ playerId: nflverseInjuries.playerId, reportStatus: nflverseInjuries.reportStatus })
    .from(nflverseInjuries)
    .where(
      and(
        eq(nflverseInjuries.season, season),
        eq(nflverseInjuries.week, WEEK_ONE),
        inArray(nflverseInjuries.playerId, [...playerIds]),
        isNotNull(nflverseInjuries.dateModified),
        lte(nflverseInjuries.dateModified, asOf),
      ),
    );
  const unavailable = new Set([...UNAVAILABLE_REPORT_STATUSES].map((word) => word.toLowerCase()));
  return new Set(rows.filter((row) => unavailable.has(row.reportStatus.trim().toLowerCase())).map((row) => row.playerId));
}
