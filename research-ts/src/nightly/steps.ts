import { and, eq, max } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { nflPlayers, preseasonProjections } from "@research-ts/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { CAPSULE_CONFIG } from "@research-ts/capsules/config";
import { getStoredCapsulesFor, queueCapsuleRegeneration } from "@research-ts/capsules/store";
import { describeSweep, sweepCapsules } from "@research-ts/capsules/sweep";
import { voiceRuleHits } from "@research-ts/capsules/voice-rules";
import { envOrUndefined } from "@research-ts/lib/env";
import { harvestCaptures } from "@research-ts/projections/harvest";
import { ingestAdpSnapshot } from "@research-ts/projections/market/adp-snapshot";
import { snapshotPreseasonProps } from "@research-ts/projections/odds/preseason-snapshot";
import { refreshWinTotals } from "@research-ts/projections/vegas/win-totals-refresh";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { BOARD_FORMATS, boardSourceFor, type BoardFormat } from "@research-ts/projections/preseason/board-formats";
import { INGESTED_SEASONS, persistSeason, type SeasonTake } from "@research-ts/projections/preseason/persist";
import { firstKickoffFor } from "@research-ts/projections/team-store";
import { TANK01_CONFIG } from "@research-ts/stats/tank01/config";
import type { StepRecord } from "./artifacts";
import { NIGHTLY_CONFIG } from "./config";

/** What a step needs from the run: the connection, the clock, and where its operator lines go. */
export interface StepContext {
  readonly db: Db;
  readonly clock: Clock;
  readonly log: (line: string) => void;
}

/** The odds provider's key, read by the props snapshot (`projections/odds/http.ts`). */
const ODDS_API_KEY_ENV = "ODDS_API_KEY";

/**
 * INGEST: the provider capture the capsules read facts from (injuries, news, depth charts, inactives,
 * betting lines; `projections/harvest.ts`), tonight's ADP in every format
 * (`projections/market/adp-snapshot.ts`), the pre-kickoff props snapshot and the win totals (both
 * no-ops once the product season has kicked off). A capture whose key is not set is skipped by
 * name; the others still run. The step fails only when the ADP capture failed in every format.
 */
export async function ingestStep({ db, clock }: StepContext): Promise<StepRecord> {
  const parts: string[] = [];
  if (envOrUndefined(TANK01_CONFIG.envVars.apiKey) === undefined) {
    parts.push(`capture skipped, ${TANK01_CONFIG.envVars.apiKey} is not set`);
  } else {
    const harvest = await harvestCaptures(db, clock, {});
    parts.push(`${harvest.summary}, ${harvest.moved.length} player(s) moved`);
  }
  const adp = await ingestAdpSnapshot(db, { now: () => new Date(clock.now()) });
  parts.push(
    envOrUndefined(ODDS_API_KEY_ENV) === undefined ? `props skipped, ${ODDS_API_KEY_ENV} is not set` : (await snapshotPreseasonProps(db, clock, {})).summary,
  );
  parts.push((await refreshWinTotals(db, clock, {})).summary);
  const failed = adp.byFormat.filter((format) => format.error !== null);
  parts.push(`adp: ${adp.written} rows written over ${adp.byFormat.length} formats${failed.map((format) => `, ${format.format} failed: ${format.error}`).join("")}`);
  return { name: "ingest", status: failed.length === adp.byFormat.length ? "failed" : "ran", summary: parts.map((part) => part.replace(/\.+$/, "")).join(". ") };
}

/** The instant the served board's newest stored generation was taken, or null when none is stored. */
async function servedGenerationMoment(db: Db, season: number): Promise<Date | null> {
  const [row] = await db
    .select({ asOf: max(preseasonProjections.asOf) })
    .from(preseasonProjections)
    .where(and(eq(preseasonProjections.season, season), eq(preseasonProjections.source, BOARD_SOURCE)));
  return row?.asOf ?? null;
}

/** One season to rebuild, the clock its board moment is read from, and the formats it stores. */
interface CheckTarget {
  readonly season: number;
  readonly clock: Clock;
  readonly formats: readonly BoardFormat[];
  readonly why: string;
}

/** The blended formats a season holds a stored board for. Archived seasons hold PPR only. */
async function storedFormats(db: Db, season: number): Promise<readonly BoardFormat[]> {
  const rows = await db.selectDistinct({ source: preseasonProjections.source }).from(preseasonProjections).where(eq(preseasonProjections.season, season));
  const sources = new Set(rows.map((row) => row.source));
  return BOARD_FORMATS.filter((format) => sources.has(boardSourceFor(format)));
}

/**
 * WHICH BOARDS THE CHECK CAN REBUILD. Before the product season's first kickoff, its live board,
 * at the moment the stored generation was taken (the clock pinned to its `as_of`, so `liveMomentFor`
 * returns that same moment). After kickoff the engine refuses to rebuild a live board at all (a
 * live board may not see a game the season has played, `source.ts`), so the check rebuilds the
 * archived replay boards instead (`INGESTED_SEASONS`), each at its own replay moment: the same code
 * path, the same blend, and stored rows to compare with.
 */
async function checkTargets(db: Db, clock: Clock): Promise<{ readonly targets: readonly CheckTarget[]; readonly skipped: readonly string[] } | string> {
  const kickoff = await firstKickoffFor(db, PRODUCT_SEASON);
  if (kickoff === null || new Date(clock.now()) < kickoff) {
    const moment = await servedGenerationMoment(db, PRODUCT_SEASON);
    if (moment === null) return `no stored ${BOARD_SOURCE} generation for ${PRODUCT_SEASON} to check against`;
    const target = { season: PRODUCT_SEASON, clock: { now: () => moment.toISOString() }, formats: await storedFormats(db, PRODUCT_SEASON), why: `live board at its stored moment ${moment.toISOString()}` };
    return { targets: [target], skipped: [] };
  }
  // A replay moment is derived from the season's schedule, so an archived season the store holds no
  // schedule for cannot be rebuilt (`liveMomentFor`/`preseasonMomentFor` refuse to guess one).
  const targets: CheckTarget[] = [];
  const skipped: string[] = [];
  for (const season of INGESTED_SEASONS) {
    const formats = await storedFormats(db, season);
    if (formats.length === 0) skipped.push(`${season} (no stored board)`);
    else if ((await firstKickoffFor(db, season)) === null) skipped.push(`${season} (no ingested schedule)`);
    else targets.push({ season, clock, formats, why: `archived replay board, ${PRODUCT_SEASON} kicked off ${kickoff.toISOString()}` });
  }
  return targets.length === 0 ? `${PRODUCT_SEASON} has kicked off and no archived season can be rebuilt: ${skipped.join(", ")}` : { targets, skipped };
}

/** The store's own refusal when an input a board needs is not held at the board's moment
 *  (`source.ts`, `team-store.ts`, `replay-moments.ts`: "The store holds no ..."). */
const MISSING_INPUT_REFUSAL = /^The store holds no /;

/** One target's rebuild, or the store's refusal to rebuild it for want of an input. Any other error
 *  is a real failure and propagates. */
async function rebuildOrRefusal(db: Db, target: CheckTarget, names: ReadonlyMap<string, string>, log: (line: string) => void, tolerance: number): Promise<SeasonTake | string> {
  try {
    return await persistSeason(db, target.season, target.clock, names, { diffOnly: true, formats: target.formats, log, pointTolerance: tolerance });
  } catch (error) {
    if (error instanceof Error && MISSING_INPUT_REFUSAL.test(error.message)) return error.message.split(". ")[0]!;
    throw error;
  }
}

/** What one season's rebuild found against the store: empty when it matches. */
function driftOf(take: SeasonTake, tolerance: number): readonly string[] {
  return take.diffs.flatMap((leg) => {
    const reasonsMoved = leg.diffs.reduce((sum, diff) => sum + diff.added + diff.removed + diff.changed, 0);
    const { points } = leg;
    const where = `${take.season} ${leg.source}`;
    return [
      ...(points.overTolerance > 0 ? [`${where}: ${points.overTolerance} point fields over ${tolerance} (max ${points.maxAbsDelta.toFixed(4)}, ${points.worst?.playerId} ${points.worst?.field})`] : []),
      ...(points.missingFromRebuild.length > 0 ? [`${where}: ${points.missingFromRebuild.length} stored players not rebuilt`] : []),
      ...(points.missingFromStore.length > 0 ? [`${where}: ${points.missingFromStore.length} rebuilt players not stored`] : []),
      ...(reasonsMoved > 0 ? [`${where}: ${reasonsMoved} reasons would change`] : []),
    ];
  });
}

/**
 * FIT: the boards, through the one board builder the operator script uses (`persistSeason`). By
 * default it CHECKS: each board `checkTargets` names is rebuilt and compared with the stored
 * generation at the same moment, points and reasons, writing nothing. Any point field past
 * `NIGHTLY_CONFIG.fitPointTolerance`, any player on one side only, or any reason that would change
 * fails the step: the code or its point-in-time inputs moved, which is the drift a parity oracle
 * exists to catch. Retaking the product season's live board replaces what the site serves and what
 * the register freezes (`persist.ts`'s own INGESTED_SEASONS note), so it is a deliberate act:
 * `--persist-board`.
 */
export async function fitStep({ db, clock, log }: StepContext, persist: boolean): Promise<StepRecord> {
  const names = new Map((await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const));
  if (persist) {
    const take = await persistSeason(db, PRODUCT_SEASON, clock, names, { log });
    const written = take.written.map((leg) => `${leg.source} ${leg.counts.written} rows`).join(", ");
    return { name: "fit", status: "ran", summary: `${PRODUCT_SEASON} ${take.momentKind} board written: ${written}` };
  }
  const plan = await checkTargets(db, clock);
  if (typeof plan === "string") return { name: "fit", status: "failed", summary: plan };
  const tolerance = NIGHTLY_CONFIG.fitPointTolerance;
  const findings: string[] = [];
  const compared: string[] = [];
  const unbuildable = [...plan.skipped];
  for (const target of plan.targets) {
    const take = await rebuildOrRefusal(db, target, names, log, tolerance);
    if (typeof take === "string") {
      unbuildable.push(`${target.season} (${take})`);
      continue;
    }
    findings.push(...driftOf(take, tolerance));
    const worst = Math.max(...take.diffs.map((leg) => leg.points.maxAbsDelta));
    compared.push(`${target.season} (${target.why}) ${take.diffs.length} boards, max |delta| ${worst.toFixed(4)}`);
  }
  const skipped = unbuildable.length === 0 ? "" : `; not rebuildable: ${unbuildable.join(", ")}`;
  if (compared.length === 0) {
    // NOTHING COULD BE REBUILT: after kickoff the live board is closed to a rebuild by design, and an
    // archived season whose inputs the store no longer holds cannot be retaken either. That is not
    // drift, and nothing can drift a stored board in that state (a write is refused the same way),
    // so the step says so by name rather than failing every night until the next preseason.
    return { name: "fit", status: "skipped", summary: `no board could be rebuilt to check${skipped}` };
  }
  const header = `rebuilt and compared, nothing written: ${compared.join("; ")}${skipped}`;
  return findings.length === 0
    ? { name: "fit", status: "ran", summary: `${header}; every board matches within ${tolerance} points with the same reasons` }
    : { name: "fit", status: "failed", summary: `${header}; DRIFT: ${findings.join("; ")}` };
}

/**
 * CAPSULES: every capsule still carrying a set phrase or an aside is queued for a rewrite, then the
 * sweep writes every player whose facts moved, whose row is missing or whose read is the template.
 * Without the writer's key the step is skipped by name rather than run, because a sweep with no key
 * would demote every written read it touched to the template.
 */
export async function capsuleStep({ db, clock }: StepContext, playerIds: readonly string[]): Promise<StepRecord> {
  const apiKey = envOrUndefined(CAPSULE_CONFIG.gateway.envVars.apiKey);
  if (apiKey === undefined) return { name: "capsules", status: "skipped", summary: `${CAPSULE_CONFIG.gateway.envVars.apiKey} is not set, stored capsules are published as they are` };
  const stored = await getStoredCapsulesFor(db, playerIds);
  const offenders = [...stored.values()].filter((capsule) => voiceRuleHits(`${capsule.bodyFull} ${capsule.bodyCompact}`).length > 0).map((capsule) => capsule.playerId);
  const queued = await queueCapsuleRegeneration(db, offenders);
  const report = await sweepCapsules(db, clock, { apiKey });
  return { name: "capsules", status: "ran", summary: `${queued} queued for a voice-rule rewrite. ${describeSweep(report)}` };
}
