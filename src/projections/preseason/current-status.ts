import type { ReadonlyDb } from "@/db/client";
import { depthChartStatuses } from "./depth-read";
import type { CurrentRosterStatus, SweepPhase } from "./roster-status";
import { coverageOf, harvestReads, harvestStatusFor, tank01IdsFor, weekOneOutReportsAsOf, weekOneStatuses, type SweepCoverage } from "./roster-status-read";
import type { PreseasonInputs } from "./source";

/**
 * THE ONE RESOLUTION OF "WHAT IS THIS PLAYER'S STATUS TODAY" (current-status round, 2026-09-09) —
 * the function the board's gate (`roster-status-gate.ts`, through `market/blend.ts`) and the
 * availability model's status input (`source.ts`'s `emit`, `availability-history.ts`'s fit
 * observations, through `availability-status.ts`) both call, so the two can never again answer
 * differently. Before this round the gate read the Tank01 captures and the model read the cutdown
 * file, and Josh Jacobs was active in one and `reserve` in the other.
 *
 * THE PRECEDENCE, as `roster-status.ts` has always stated it: the harvest's two Tank01 captures
 * (the newest of each at or before `asOf`; within them the fresher capture's word wins, and absence
 * from a sweep counts only when the sweep is COMPLETE — every one of the 32 clubs, none thinner
 * than the phase's floor), then the season's week-one `nflverse_roster_weeks` row with its detail
 * code, then the week-one depth chart, which can only say he is listed with a club. A player none
 * of them names is absent from the result, never filled in; the model then keeps the cutdown file's
 * own word for him (`availabilityStatusFor`).
 *
 * THE OUT DESIGNATION IS A DETAIL ON AN ACTIVE STATUS, FROM ANY DATED SOURCE. The Tank01 captures
 * carry it themselves (`currentStatusFromTank01`). For a replay season the week-one injury report
 * carries it too, dated by nflverse's own `date_modified`, and a row dated at or before `asOf`
 * marks an active man `out` whichever source made him active. A reserve kind is never touched by
 * it: a man on injured reserve is already accounted for.
 */
export interface CurrentStatusReadOptions {
  readonly season: number;
  readonly asOf: Date;
  readonly playerIds: readonly string[];
  /** The date the roster ingest claims for the week-one file (`preseason_rosters.as_of`). */
  readonly weekOneStampedAt: Date;
  /** Which floor a club's sweep membership is judged against (`SWEEP_MINIMUM_CLUB_SIZE`). */
  readonly phase: SweepPhase;
}

export interface CurrentStatusRead {
  readonly statuses: ReadonlyMap<string, CurrentRosterStatus>;
  /** `null` when no sweep capture at or before `asOf` exists. */
  readonly sweep: SweepCoverage | null;
}

/** An active status with the week-one report's Out on it; any other status, or a reserve kind, as it was. */
function withReportedOut(status: CurrentRosterStatus, ruledOut: boolean): CurrentRosterStatus {
  return ruledOut && status.kind === "active" && status.detail === null ? { ...status, detail: "out" } : status;
}

/** The resolution. See the module docblock for the sources and their precedence. */
export async function currentStatusesAsOf(db: ReadonlyDb, { season, asOf, playerIds, weekOneStampedAt, phase }: CurrentStatusReadOptions): Promise<CurrentStatusRead> {
  if (playerIds.length === 0) return { statuses: new Map(), sweep: null };
  const [tank01Ids, harvest, weekOne, depth, ruledOut] = await Promise.all([
    tank01IdsFor(db, playerIds),
    harvestReads(db, asOf, phase),
    weekOneStatuses(db, season, playerIds, weekOneStampedAt),
    depthChartStatuses(db, season, asOf, playerIds),
    weekOneOutReportsAsOf(db, season, asOf, playerIds),
  ]);
  const statuses = new Map<string, CurrentRosterStatus>();
  for (const playerId of playerIds) {
    const status = harvestStatusFor(tank01Ids.get(playerId) ?? [], harvest) ?? weekOne.get(playerId) ?? depth.get(playerId);
    if (status !== undefined && status !== null) statuses.set(playerId, withReportedOut(status, ruledOut.has(playerId)));
  }
  return { statuses, sweep: coverageOf(harvest.sweep) };
}

/** A LIVE moment is before the season's first kickoff by construction (`liveMomentFor`), so its
 *  sweep is a cutdown roster; a replay moment is a played season's. */
export function sweepPhaseFor(momentKind: PreseasonInputs["momentKind"]): SweepPhase {
  return momentKind === "live" ? "cutdown" : "in_season";
}

/** The stamp the roster ingest claims for this season's week-one file, read off the rows the
 *  inputs already hold rather than re-derived — the one date `roster-status-read.ts` will not
 *  invent for itself. */
export function weekOneRosterStampOf(inputs: PreseasonInputs): Date {
  return inputs.roster.reduce((latest, row) => (row.asOf > latest ? row.asOf : latest), inputs.roster[0]?.asOf ?? inputs.moment);
}

/** `PreseasonInputs` with the resolution taken: `currentStatus` is present, never optional. */
export interface StatusedPreseasonInputs extends PreseasonInputs {
  readonly currentStatus: ReadonlyMap<string, CurrentRosterStatus>;
}

export interface StatusedInputsRead {
  readonly inputs: StatusedPreseasonInputs;
  readonly sweep: SweepCoverage | null;
}

/**
 * The inputs with the resolution attached for every man on the week-one roster, at the board's own
 * moment and phase. The shipped build (`market/blend.ts`) and the availability fit
 * (`availability-history.ts`) both go through here, which is what makes "one resolution" true of
 * the code rather than of the intention.
 */
export async function withCurrentStatus(db: ReadonlyDb, inputs: PreseasonInputs): Promise<StatusedInputsRead> {
  const { statuses, sweep } = await currentStatusesAsOf(db, {
    season: inputs.season,
    asOf: inputs.moment,
    playerIds: inputs.roster.map((row) => row.playerId),
    weekOneStampedAt: weekOneRosterStampOf(inputs),
    phase: sweepPhaseFor(inputs.momentKind),
  });
  return { inputs: { ...inputs, currentStatus: statuses }, sweep };
}
