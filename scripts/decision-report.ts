// Scores the DECISION layer, which is a different measurement from scoring the projections.
// Run: npm run projections:decisions [season ...]   (defaults to the two held-out seasons)
//
// `projection-report.ts` answers "did the projection order players correctly". This answers the
// only question a manager cares about: would following the advice have left him with a better
// team. A model can rank well and advise badly, and nothing in the prediction scoreboard would
// notice.
//
// Reads the store and nothing else. Unlike `projection-report.ts` it does not ingest, because
// every number here is computed from seasons the backfill has already landed, and re-fetching
// them would put a network dependency in front of a measurement that has none.
import { createDb } from "@/db/client";
import type { Position, StatLine } from "@/domain/player";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { allPositions } from "@/projections/backtest";
import { emptyTeamContext } from "@/projections/team-context";
import { naiveProjection } from "@/projections/benchmarks/naive";
import type { DraftCandidate } from "@/projections/decide/draft";
import type { LineupCandidate } from "@/projections/decide/lineup";
import { outlookAround, realizedDispersion } from "@/projections/decide/outlook";
import { valueBoard, type LeagueShape, type SeasonProjection } from "@/projections/decide/replacement";
import {
  byProjectedPoints,
  byRecommendation,
  byStartersFirstPoints,
  byValueOverReplacement,
  lineupRegret,
  pairedDraftReplay,
  replayDraft,
  scoreSleepers,
  type PairedDraftResult,
} from "@/projections/decide/replay";
import { sleepers } from "@/projections/decide/sleepers";
import { statLinesAsOf, type SeasonStatLine } from "@/projections/lines";
import { modelProjection } from "@/projections/model/source";
import { LAST_POSSIBLE_WEEK } from "@/projections/store";
import { usageAsOf, type PlayerWeekUsage } from "@/projections/usage";

const SEASONS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2023, 2024];
const LAST_REGULAR_WEEK = 18;
const GAMES_IN_A_SEASON = 17;
const HISTORY_SEASONS = 2;
/**
 * A starting fantasy player's week-to-week spread before we have watched him vary. Roughly what a
 * mid-range starter shows over a season, and used only until he has four weeks of his own.
 */
const DEFAULT_WEEKLY_SPREAD = 6;
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/**
 * The four positions Phase 2 actually projects. Kickers and team defences compose to exactly zero
 * (`model/compose.ts`), so leaving their slots in the shape would hand every seat two guaranteed
 * blanks and measure nothing but who was left holding them.
 */
const PROJECTED_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];
const DECISION_SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot !== "K" && slot.slot !== "DEF",
).map((slot) =>
  slot.slot === BENCH_SLOT ? { ...slot, eligiblePositions: PROJECTED_POSITIONS } : slot,
);
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: DECISION_SLOTS };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:decisions\`.`);
  }
  return value;
}

function points(line: StatLine, position: Position): number {
  return computeFantasyPoints(line, position, PPR_SCORING);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

/** Season totals from the raw weekly lines. Outcomes: never shown to a seat, only to the scoring. */
function seasonPoints(
  lines: readonly SeasonStatLine[],
  positions: ReadonlyMap<string, Position>,
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const { line } of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    totals.set(line.playerId, (totals.get(line.playerId) ?? 0) + points(line, position));
  }
  return totals;
}

/**
 * Actual points keyed by CALENDAR WEEK, never by games played.
 *
 * The distinction is load-bearing and the first draft of this script got it wrong: a man who
 * missed week 1 has his week-2 score first in a list of games played, and reading that list
 * positionally credits every one of his scores to the week before it happened. That is a leak of
 * the most flattering kind, and no test above this script would have caught it.
 */
function pointsByWeek(
  lines: readonly SeasonStatLine[],
  positions: ReadonlyMap<string, Position>,
): ReadonlyMap<number, ReadonlyMap<string, number>> {
  const byWeek = new Map<number, Map<string, number>>();
  for (const { line } of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    const week = byWeek.get(line.week) ?? new Map<string, number>();
    week.set(line.playerId, points(line, position));
    byWeek.set(line.week, week);
  }
  return byWeek;
}

/** The last moment each week's numbers were stamped, so week W can be replayed from week W-1. */
function weekAsOf(lines: readonly SeasonStatLine[]): ReadonlyMap<number, Date> {
  const latest = new Map<number, Date>();
  for (const row of lines) {
    const known = latest.get(row.line.week);
    if (known === undefined || row.asOf > known) latest.set(row.line.week, row.asOf);
  }
  return latest;
}

function toSeasonProjections(
  lines: readonly StatLine[],
  positions: ReadonlyMap<string, Position>,
  perGameMultiplier: number,
): readonly SeasonProjection[] {
  const projections: SeasonProjection[] = [];
  for (const line of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined || !PROJECTED_POSITIONS.includes(position)) continue;
    projections.push({
      playerId: line.playerId,
      position,
      projectedPoints: points(line, position) * perGameMultiplier,
    });
  }
  return projections;
}

/**
 * A draft board with a market price attached.
 *
 * THE MARKET HERE IS THE ROOM ITSELF, and that is a claim worth stating plainly rather than
 * burying. No point-in-time average draft position exists in this repository: `players.adp` is a
 * current-value column with no history and no join to the historical universe. So the price a
 * player carries is his rank on the projected-points board, which is exactly how the eleven
 * opponents in this replay draft. The survival model is therefore being asked to predict the room
 * it is actually in, which is the right question, and no claim is made about a real market.
 */
function boardWithMarket(projections: readonly SeasonProjection[]): readonly DraftCandidate[] {
  const priced = new Map(
    [...projections]
      .sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))
      .map((player, index) => [player.playerId, index + 1]),
  );
  return valueBoard(projections, SHAPE).map((player) => ({
    ...player,
    averageDraftPosition: priced.get(player.playerId)!,
  }));
}

function pairedLine(name: string, result: PairedDraftResult): string {
  return (
    `${name.padEnd(22)} mean ${signed(result.meanImprovement).padStart(8)}   ` +
    `median ${signed(result.medianImprovement).padStart(8)}   ` +
    `seats improved ${result.seatsImproved}/${result.seatCount}`
  );
}

interface SeasonInputs {
  readonly preseasonMoment: Date;
  readonly positions: ReadonlyMap<string, Position>;
  readonly priorHistory: readonly SeasonStatLine[];
  readonly priorUsage: readonly PlayerWeekUsage[];
  readonly actualSeason: ReadonlyMap<string, number>;
  readonly actualByWeek: ReadonlyMap<number, ReadonlyMap<string, number>>;
  readonly asOfForWeek: (week: number) => Date;
}

async function loadSeason(db: ReturnType<typeof createDb>, season: number): Promise<SeasonInputs> {
  const positions = await allPositions(db);
  const actualLines = await statLinesAsOf(db, {
    season,
    week: { from: 1, to: LAST_REGULAR_WEEK },
    asOf: FINAL_OUTCOME,
  });
  if (actualLines.length === 0) {
    throw new Error(`No stat lines for ${season}. Run \`npm run projections:backfill\` first.`);
  }

  /**
   * THE PRESEASON MOMENT: the first instant anything about this season was knowable. Everything
   * stamped before it is what a manager had on draft day, and a board built from it cannot
   * possibly have read a game it is being scored on.
   */
  const preseasonMoment = new Date(Math.min(...actualLines.map((row) => row.asOf.getTime())));
  const stamped = weekAsOf(actualLines);

  const priorSpan = { week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: preseasonMoment } as const;
  const priorHistory: SeasonStatLine[] = [];
  const priorUsage: PlayerWeekUsage[] = [];
  for (let back = HISTORY_SEASONS; back >= 1; back -= 1) {
    priorHistory.push(...(await statLinesAsOf(db, { season: season - back, ...priorSpan })));
    priorUsage.push(...(await usageAsOf(db, { season: season - back, ...priorSpan })));
  }

  return {
    preseasonMoment,
    positions,
    priorHistory,
    priorUsage,
    actualSeason: seasonPoints(actualLines, positions),
    actualByWeek: pointsByWeek(actualLines, positions),
    asOfForWeek: (week) => stamped.get(week - 1) ?? preseasonMoment,
  };
}

/**
 * THE DRAFT REPLAY. Every seat drafted twice against the same eleven opponents on the same board,
 * once with the strategy under test and once without, at all twelve seats.
 */
function reportDraft(board: readonly DraftCandidate[], actualPoints: ReadonlyMap<string, number>): void {
  for (const [label, baseline] of [
    ["plain points ranking", byProjectedPoints],
    ["starters first, then points", byStartersFirstPoints],
  ] as const) {
    console.log(`  every other seat drafts: ${label}`);
    for (const [name, underTest] of [
      ["value over replacement", byValueOverReplacement],
      ["full recommendation", byRecommendation],
    ] as const) {
      console.log(
        `    ${pairedLine(name, pairedDraftReplay({ board, shape: SHAPE, baseline, underTest, actualPoints }))}`,
      );
    }
  }
}

/**
 * THE SLEEPER LIST, SCORED WITH ITS MISSES. Our board is the model's preseason projection; the
 * market it disagrees with is last season's points per game, which is what a room prices from
 * when nobody has a projection of their own.
 */
function reportSleepers(
  modelBoard: readonly DraftCandidate[],
  naiveProjections: readonly SeasonProjection[],
  actualPoints: ReadonlyMap<string, number>,
): void {
  const market = [...naiveProjections]
    .sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))
    .map((player, index) => ({ playerId: player.playerId, averageDraftPosition: index + 1 }));

  const named = sleepers({ board: modelBoard, market, limit: 15 });
  const card = scoreSleepers({ sleepers: named, market, actualPoints });
  console.log(
    `  named ${named.length}   hits ${card.hits}   hit rate ${(card.hitRate * 100).toFixed(0)}%   ` +
      `base rate ${(card.baseRate * 100).toFixed(0)}%`,
  );
  for (const outcome of card.outcomes) {
    console.log(
      `    ${outcome.hit ? "HIT " : "miss"} ${outcome.playerId.padEnd(12)} ` +
        `ours ${String(outcome.ourRank).padStart(3)}  market ${String(outcome.marketRank).padStart(3)}  ` +
        `finished ${String(outcome.actualRank).padStart(3)}  (${signed(outcome.beatMarketBy)})`,
    );
  }
}

/** THE START/SIT REGRET: points left on the bench against the lineup hindsight would have started. */
async function reportLineups(
  db: ReturnType<typeof createDb>,
  season: number,
  inputs: SeasonInputs,
  board: readonly DraftCandidate[],
): Promise<void> {
  const drafted = replayDraft({
    board,
    shape: SHAPE,
    seats: Array.from({ length: SHAPE.teamCount }, () => byRecommendation),
  });
  const played = new Map<string, number[]>();
  let ourRegret = 0;
  let baselineRegret = 0;
  let weeksScored = 0;

  for (let week = 1; week <= LAST_REGULAR_WEEK; week += 1) {
    // Week W is replayed from the moment week W-1's numbers landed, the same discipline
    // `backtest.ts` holds itself to. Reading the weeks already played at their FINAL values would
    // show the model corrections stamped after the week it is projecting.
    const asOf = inputs.asOfForWeek(week);
    const span = { season, week: { from: 1, to: week - 1 }, asOf } as const;
    const seasonSoFar = week === 1 ? [] : await statLinesAsOf(db, span);
    const usageSoFar = week === 1 ? [] : await usageAsOf(db, span);
    const projected = modelProjection({
      season,
      week,
      asOf,
      // EMPTY ON PURPOSE, and it is a measurement decision rather than a stub. Phase 3 made team
      // context a required input AFTER this harness produced the numbers in
      // `docs/research/2026-08-27-decision-quality.md`. Feeding it real context now would leave
      // the script and its own published findings describing different runs, which is the quiet
      // way a research doc stops being true. Re-running the whole harness against Phase 3's
      // context (and Phase 6's preseason board) is the doc's own top recommendation, and it is a
      // deliberate follow-up rather than a line changed in passing.
      teamContext: emptyTeamContext,
      history: [...inputs.priorHistory, ...seasonSoFar],
      usage: [...inputs.priorUsage, ...usageSoFar],
      positions: inputs.positions,
    });
    const projectedPoints = new Map(
      projected.flatMap((line) => {
        const position = inputs.positions.get(line.playerId);
        return position === undefined ? [] : [[line.playerId, points(line, position)] as const];
      }),
    );
    const actualThisWeek = inputs.actualByWeek.get(week) ?? new Map<string, number>();

    // Spread from what a player has ALREADY done this season, never from a projection. For a man
    // with too few weeks the fallback is the TYPICAL player's own week-to-week spread, which is
    // the honest "we do not know him yet" rather than a confident zero. Not the spread of the
    // pooled scores, which measures how players differ from each other and not how a player
    // varies from himself.
    const spreads = [...played.values()]
      .map((weeks) => realizedDispersion(weeks))
      .filter((spread): spread is number => spread !== null)
      .sort((a, b) => a - b);
    const leagueSpread = spreads[Math.floor(spreads.length / 2)] ?? DEFAULT_WEEKLY_SPREAD;

    const candidatesFor = (roster: readonly { playerId: string; position: Position }[]): readonly LineupCandidate[] =>
      roster.flatMap((player) => {
        const median = projectedPoints.get(player.playerId);
        if (median === undefined) return [];
        const spread = realizedDispersion(played.get(player.playerId) ?? []) ?? leagueSpread;
        return [{ playerId: player.playerId, position: player.position, outlook: outlookAround(median, Math.max(spread, 0.5)) }];
      });

    const lineups = drafted.rostersBySeat.map(candidatesFor);
    const expected = lineups.map((candidates) =>
      candidates.reduce((sum, candidate) => sum + candidate.outlook.median, 0),
    );

    for (let seat = 0; seat < lineups.length; seat += 1) {
      const opponent = seat % 2 === 0 ? seat + 1 : seat - 1;
      const regret = lineupRegret(
        {
          candidates: lineups[seat]!,
          matchup: {
            projectedMargin: expected[seat]! - expected[opponent]!,
            opponentStandardDeviation: Math.max(leagueSpread * 3, 1),
          },
          actualPoints: actualThisWeek,
        },
        SHAPE,
      );
      ourRegret += regret.regret;
      baselineRegret += regret.baselineRegret;
      weeksScored += 1;
    }

    for (const [playerId, scored] of actualThisWeek) {
      played.set(playerId, [...(played.get(playerId) ?? []), scored]);
    }
  }

  console.log(
    `  regret per team-week: matchup aware ${(ourRegret / weeksScored).toFixed(2)}   ` +
      `plain ranking ${(baselineRegret / weeksScored).toFixed(2)}   ` +
      `difference ${signed((baselineRegret - ourRegret) / weeksScored)}`,
  );
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  for (const season of TARGET_SEASONS) {
    const inputs = await loadSeason(db, season);
    console.log(`\n=== ${season} (preseason moment ${inputs.preseasonMoment.toISOString()}) ===`);

    const naiveBoard = toSeasonProjections(
      naiveProjection(inputs.priorHistory, { season, week: 1 }),
      inputs.positions,
      GAMES_IN_A_SEASON,
    );
    const modelBoard = toSeasonProjections(
      modelProjection({
        season,
        week: 1,
        asOf: inputs.preseasonMoment,
        // Empty for the same reason as above, and doubly honest here: at a preseason moment there
        // is no in-season team context to read yet.
        teamContext: emptyTeamContext,
        history: inputs.priorHistory,
        usage: inputs.priorUsage,
        positions: inputs.positions,
      }),
      inputs.positions,
      GAMES_IN_A_SEASON,
    );
    console.log(`board: ${naiveBoard.length} priced by last season, ${modelBoard.length} by the model`);

    console.log("\nDRAFT REPLAY, on the naive preseason board");
    reportDraft(boardWithMarket(naiveBoard), inputs.actualSeason);

    console.log("\nDRAFT REPLAY, on the model preseason board");
    reportDraft(boardWithMarket(modelBoard), inputs.actualSeason);

    console.log("\nSLEEPERS");
    reportSleepers(boardWithMarket(modelBoard), naiveBoard, inputs.actualSeason);

    console.log("\nSTART AND SIT");
    await reportLineups(db, season, inputs, boardWithMarket(modelBoard));
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
