import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { captureSnapshots, nflPlayers, nflverseRosterWeeks, playerCrosswalk } from "@/db/schema";
import { observationsAsOf } from "../store";
import { DEPTH_METRIC, DEPTH_SOURCE } from "./depth";
import {
  currentStatusFromTank01,
  readActiveRosterSweep,
  readPlayerListings,
  rosterStatusFromNflverseCode,
  sweepIsComplete,
  type CurrentRosterStatus,
  type RosterSweepCapture,
  type SweepPhase,
  type Tank01Listing,
} from "./roster-status";

/**
 * THE FRESHEST ROSTER STATUS PER PLAYER AS OF A MOMENT — the one read behind the board's gate
 * (`roster-status-gate.ts`), so every board build and every re-measure reads the same thing.
 *
 * THREE SOURCES, IN THE PRECEDENCE `roster-status.ts` states: the harvest's two Tank01 captures
 * (the newest of each at or before `asOf`), then the season's week-one `nflverse_roster_weeks`
 * row, then the week-one depth chart, which can only say he is listed with a club. A player none
 * of them names is absent from the result — never filled in.
 *
 * IDENTITY. The captures key on Tank01's own id, which is the ESPN id; the board keys on the gsis
 * id. `nflPlayers.espnId` resolves most of the board (544 of 546 on the 2026 board when this was
 * built) and `player_crosswalk` resolves a further few through the product's own player row; both
 * are tried, and a player neither resolves is simply not matched to a capture — the week-one row
 * and the depth chart, which already key on the gsis id, still speak for him.
 *
 * THE WEEK-ONE ROW'S DATE IS THE CALLER'S CLAIM. `nflverse_roster_weeks` archives the code with no
 * stamp of its own, and this module will not invent one: `weekOneStampedAt` is the date the roster
 * ingest already asserts for the same file (`preseason_rosters.as_of`, the cutdown), passed in so
 * the two readers of one file can never disagree about when it was knowable.
 *
 * BOUNDED. Every read takes `playerIds`; the two captures are one `LIMIT 1` row each.
 */
export interface RosterStatusReadOptions {
  readonly season: number;
  readonly asOf: Date;
  readonly playerIds: readonly string[];
  readonly weekOneStampedAt: Date;
  /** Which floor a club's sweep membership is judged against (`SWEEP_MINIMUM_CLUB_SIZE`). */
  readonly phase: SweepPhase;
}

/** What the sweep the read leaned on actually covered, for the caller's own summary line. */
export interface SweepCoverage {
  readonly capturedAt: Date;
  readonly clubCount: number;
  readonly smallestClub: number | null;
  readonly complete: boolean;
}

export interface RosterStatusRead {
  readonly statuses: ReadonlyMap<string, CurrentRosterStatus>;
  /** `null` when no sweep capture at or before `asOf` exists. */
  readonly sweep: SweepCoverage | null;
}

interface Capture {
  readonly capturedAt: Date;
  readonly payload: unknown;
}

const SWEEP_FEED = "tank01_injuries";
const PLAYER_LIST_FEED = "tank01_player_list";

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
async function tank01IdsFor(db: ReadonlyDb, playerIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
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

interface HarvestReads {
  readonly sweep: RosterSweepCapture | null;
  readonly listings: ReadonlyMap<string, Tank01Listing>;
  readonly listAt: Date | null;
}

async function harvestReads(db: ReadonlyDb, asOf: Date, phase: SweepPhase): Promise<HarvestReads> {
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

function coverageOf(sweep: RosterSweepCapture | null): SweepCoverage | null {
  return sweep === null ? null : { capturedAt: sweep.capturedAt, clubCount: sweep.clubCount, smallestClub: sweep.smallestClub, complete: sweep.complete };
}

function harvestStatusFor(tank01Ids: readonly string[], harvest: HarvestReads): CurrentRosterStatus | null {
  for (const espnId of tank01Ids) {
    const status = currentStatusFromTank01({ espnId, sweep: harvest.sweep, listing: harvest.listings.get(espnId) ?? null, listAt: harvest.listAt });
    if (status !== null) return status;
  }
  return null;
}

async function weekOneStatuses(db: ReadonlyDb, season: number, playerIds: readonly string[], stampedAt: Date): Promise<ReadonlyMap<string, CurrentRosterStatus>> {
  const rows = await db
    .select({ playerId: nflverseRosterWeeks.playerId, team: nflverseRosterWeeks.team, status: nflverseRosterWeeks.status })
    .from(nflverseRosterWeeks)
    .where(and(eq(nflverseRosterWeeks.season, season), eq(nflverseRosterWeeks.week, 1), inArray(nflverseRosterWeeks.playerId, [...playerIds])));
  const out = new Map<string, CurrentRosterStatus>();
  for (const row of rows) {
    const kind = rosterStatusFromNflverseCode(row.status);
    if (kind !== null) out.set(row.playerId, { kind, source: "nflverse_roster_week_1", observedAt: stampedAt, team: row.team });
  }
  return out;
}

/** Presence on the week-one depth chart: he is listed with a club, dated by the listing itself. */
async function depthChartStatuses(db: ReadonlyDb, season: number, asOf: Date, playerIds: readonly string[]): Promise<ReadonlyMap<string, CurrentRosterStatus>> {
  const rows = await observationsAsOf(db, { season, week: 1, asOf, source: DEPTH_SOURCE, playerIds: [...playerIds] });
  const out = new Map<string, CurrentRosterStatus>();
  for (const row of rows) {
    if (row.metric !== DEPTH_METRIC) continue;
    const held = out.get(row.playerId);
    if (held === undefined || row.asOf > held.observedAt) out.set(row.playerId, { kind: "active", source: "depth_chart", observedAt: row.asOf, team: null });
  }
  return out;
}

/** The read. See the module docblock for the sources and their precedence. */
export async function rosterStatusesAsOf(db: ReadonlyDb, { season, asOf, playerIds, weekOneStampedAt, phase }: RosterStatusReadOptions): Promise<RosterStatusRead> {
  if (playerIds.length === 0) return { statuses: new Map(), sweep: null };
  const [tank01Ids, harvest, weekOne, depth] = await Promise.all([
    tank01IdsFor(db, playerIds),
    harvestReads(db, asOf, phase),
    weekOneStatuses(db, season, playerIds, weekOneStampedAt),
    depthChartStatuses(db, season, asOf, playerIds),
  ]);
  const statuses = new Map<string, CurrentRosterStatus>();
  for (const playerId of playerIds) {
    const status = harvestStatusFor(tank01Ids.get(playerId) ?? [], harvest) ?? weekOne.get(playerId) ?? depth.get(playerId);
    if (status !== undefined && status !== null) statuses.set(playerId, status);
  }
  return { statuses, sweep: coverageOf(harvest.sweep) };
}
