// THE ORACLE'S BOARDS, ROW BY ROW: the TypeScript side of the model parity cases.
//
//   DATABASE_URL=<legacy scratch> npx tsx research/parity/ts/model.ts board <season> <nowIso> [legs]
//
// Builds every leg `persistSeason` builds (the three blended formats, then the raw v1) through the
// same exported calls in the same order, at the moment `persistSeason` would take for `now`, and
// prints one JSON line per leg: every board row with every field the store keeps, the reasons, and
// the roster gate's exclusions. Nothing is written. `persist.ts` keeps `buildBoard`, its league
// shape and its priors private, so they are restated here from the same exported constants.
import { createDb, type Db } from "@research-ts/db/client";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import type { Position } from "@research-ts/domain/player";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import type { LeagueShape } from "@research-ts/projections/decide/replacement";
import { shippedPreseasonBoardInputs, type BlendConstants } from "@research-ts/projections/market/blend";
import { FITTED_BLEND_CONSTANTS } from "@research-ts/projections/market/blend-fitted";
import { marketBoard } from "@research-ts/projections/market/curve";
import { propsAnchorForSeason } from "@research-ts/projections/market/props-anchor";
import { blendConstantsWithPropsAnchor, PROPS_ANCHOR_WEIGHT_ARTIFACT } from "@research-ts/projections/market/props-anchor-artifact";
import { loadModelArtifact } from "@research-ts/projections/model/artifacts";
import { FITTED_MODEL } from "@research-ts/projections/model/source";
import { preseasonBoard } from "@research-ts/projections/preseason/board";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, type BoardFormat } from "@research-ts/projections/preseason/board-formats";
import { FITTED_AVAILABILITY_PRIORS, FITTED_CAREER_PRIORS, FITTED_DEPTH_PRIORS, FITTED_ROOKIE_PRIORS } from "@research-ts/projections/preseason/fitted";
import { loadShippedGameVariance } from "@research-ts/projections/preseason/game-variance-artifacts";
import { liveMomentFor, loadPreseason, replayMomentFor, type BoardMoment, type PreseasonPriors } from "@research-ts/projections/preseason/source";

const SCORED: readonly Position[] = ["QB", "RB", "WR", "TE"];
const SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot === BENCH_SLOT || slot.eligiblePositions.every((position) => SCORED.includes(position)),
).map((slot) => ({ ...slot, eligiblePositions: slot.eligiblePositions.filter((position) => SCORED.includes(position)) }));
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: SLOTS };
const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
  career: FITTED_CAREER_PRIORS,
};

async function boardMomentFor(db: Db, season: number, now: Date): Promise<BoardMoment> {
  try {
    return await liveMomentFor(db, season, { now: () => now.getTime() } as never);
  } catch (error: unknown) {
    if (error instanceof Error && /has already started/.test(error.message)) return await replayMomentFor(db, season);
    throw error;
  }
}

async function boards(db: Db, season: number, now: Date, legs: readonly string[]): Promise<void> {
  const moment = await boardMomentFor(db, season, now);
  const inputs = await loadPreseason(db, season, { boardMoment: moment });
  const { entries } = await marketBoard(db, season, inputs.moment);
  const propsAnchor = await propsAnchorForSeason(
    db,
    season,
    inputs.positions,
    new Map(entries.map((entry) => [entry.playerId, entry.marketPoints] as const)),
    FITTED_BLEND_CONSTANTS.impliedGamesByPosition,
  );
  const constants: BlendConstants = blendConstantsWithPropsAnchor(FITTED_BLEND_CONSTANTS, await loadModelArtifact(db, PROPS_ANCHOR_WEIGHT_ARTIFACT));
  const gameVariance = await loadShippedGameVariance(db);
  const order: readonly (BoardFormat | "raw")[] = [...BOARD_FORMATS, "raw"];
  for (const leg of order) {
    if (!legs.includes(leg)) continue;
    const raw = leg === "raw";
    const { candidates, exclusions } = await shippedPreseasonBoardInputs(db, inputs, PRIORS, {
      raw,
      ...(raw ? {} : { format: leg, constants, propsAnchor }),
    });
    const rules = raw ? PPR_SCORING : BOARD_FORMAT_SPECS[leg].rules;
    const board = preseasonBoard(candidates, { season, asOf: inputs.moment, rules, shape: SHAPE, gameVariance });
    const rows = board.map((entry) => ({
      playerId: entry.playerId,
      position: entry.position,
      team: entry.team,
      rank: entry.rank,
      positionRank: entry.positionRank,
      valueRank: entry.valueRank,
      tier: entry.tier,
      projectedPoints: entry.projectedPoints,
      valueOverReplacement: entry.valueOverReplacement,
      expectedGames: entry.expectedGames,
      floorPoints: entry.outlook.floor,
      medianPoints: entry.outlook.median,
      ceilingPoints: entry.outlook.ceiling,
      reasons: entry.reasons,
    }));
    const excluded = exclusions.map((entry) => ({ playerId: entry.playerId, status: entry.status.kind, source: entry.status.source }));
    process.stdout.write(`${JSON.stringify({ leg, moment: inputs.moment.toISOString(), momentKind: inputs.momentKind, rows, excluded })}\n`);
  }
}

async function main(): Promise<void> {
  const [command, season, nowIso, legList] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (command !== "board" || season === undefined || nowIso === undefined || url === undefined) {
    throw new Error("usage: DATABASE_URL=... tsx model.ts board <season> <nowIso> [ppr,half,std,raw]");
  }
  const db = createDb(url, { max: 2 });
  try {
    await boards(db, Number(season), new Date(nowIso), (legList ?? "ppr,half,std,raw").split(","));
  } finally {
    await db.$client.end();
  }
}

await main();
