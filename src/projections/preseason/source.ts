import { and, eq, min } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import type { Position, StatLine } from "@/domain/player";
import { playerWeekObservations } from "@/db/schema";
import { allPositions, type ProjectionInput } from "../backtest";
import { statLinesAsOf, type SeasonStatLine } from "../lines";
import { composeStatLine } from "../model/compose";
import { contextualiseOpportunity, contextualiseRates } from "../model/context";
import { predictRates } from "../model/efficiency";
import type { FeatureFlags } from "../model/features";
import { predictOpportunity, type PredictedOpportunity } from "../model/opportunity";
import { FITTED_MODEL, type ModelPriors } from "../model/source";
import type { RosterPlayer, ShareDelta } from "../features/redistribution";
import { LAST_POSSIBLE_WEEK } from "../store";
import { playerTeamsAsOf, teamObservationsAsOf, type PlayerWeekTeam, type TeamWeekObservation } from "../team-store";
import type { TeamContext } from "../team-context";
import { usageAsOf, type PlayerWeekUsage } from "../usage";
import { projectedPosition } from "../nflverse/players";
import { COACH_METRICS } from "../nflverse/coaches";
import { indexTeamMetrics } from "../team-context";
import {
  ageAtSeason,
  expectedGamesPlayed,
  seventeenGamesForEveryone,
  teamGamesIn,
  type AvailabilityPriors,
  type SeasonAvailability,
} from "./availability";
import type { BoardCandidate, BoardReason } from "./board";
import type { AvailabilityObservation, RookieObservation } from "./fit";
import { changedSituationSegment, offseasonDeltas, type OffseasonMove } from "./offseason";
import { draftBucketFor, landingMultiplier, rookieOpportunity, type RookiePriors } from "./rookies";
import { preseasonRostersAsOf, type PreseasonRosterRow } from "./store";

/**
 * READING A WHOLE PRESEASON OUT OF THE STORE, AND THE ONE MOMENT THE WHOLE PHASE RESTS ON.
 *
 * Strict week-zero discipline is the hardest constraint in this phase and the one most likely to be
 * broken silently, because offseason data is messy and dates are easy to lose. `preseasonMomentFor`
 * is where the discipline is enforced, once, for everything: every read below is gated by it, and
 * `assertNothingFromTheSeasonIsVisible` refuses to proceed if the gate is admitting a fact the
 * season itself produced.
 *
 * WHAT A BOARD FOR SEASON S IS AND IS NOT ALLOWED TO SEE:
 *
 *   - ALLOWED, and the reason this phase needed a new table: S's week-one rosters, stamped at the
 *     league's cutdown deadline in late August. Who is on which team is settled before the opener
 *     and a board that did not know it would be projecting last year's offences.
 *   - ALLOWED: S's schedule facts, stamped 20 May by `schedulePublishedAsOf` — the head coach and
 *     his tenure, which is what tells the scheme layer an offence has a new play-caller.
 *   - REFUSED: every player-week observation of S, all of which are stamped from a game day.
 *   - REFUSED: S's closing lines and recorded weather, stamped at kickoff. Model v2 reported them
 *     as unmeasurable rather than faking a date, and that standard holds here.
 *   - REFUSED: `nfl_players.latest_team` and `last_season`. They are a CURRENT snapshot — a 2023
 *     board reading them would be reading a 2026 file, and `last_season` in particular would say
 *     which players never played again, which is the future in one column.
 */

/**
 * The features the model runs with when it is projecting a whole season rather than a week.
 *
 * Scheme is ON: pace and pass rate are properties of an offence, the coaching-change prior is
 * knowable in May, and it is the mechanism through which a new play-caller reaches the board.
 * GAME CONTEXT IS OFF, and this is a correctness decision rather than an ablation. The opponent
 * adjustment is a fact about one week's opponent; applying week one's defence to all seventeen
 * games would project every player as though he faced the same team all year. It ships on the
 * weekly board, where it earned its place, and has no meaning on this one.
 */
export const PRESEASON_MODEL_FEATURES: FeatureFlags = {
  line: false,
  scheme: true,
  redistribution: false,
  gameContext: false,
  // The three groups measured after this board was built, all off here and all for reasons that
  // are stronger on a preseason board than on a weekly one.
  //
  // RED ZONE and TARGET DEPTH did not earn their place on the weekly board either
  // (`docs/research/2026-08-27-model-v3.md`), so there is nothing to inherit. Both are also
  // in-season signals by construction: a player's red-zone rate and his air yards are records of
  // snaps he has taken, and in August he has taken none.
  //
  // NEWS is off for a harder reason than a measurement. An injury designation is a fact about ONE
  // game, filed in the week of it. There is no August filing to read, and applying a September
  // designation across seventeen games would be both a leak and a lie about its meaning.
  redZone: false,
  targetDepth: false,
  news: false,
};

/** Which of Phase 6's own three groups are on. The axis every ablation in this phase flips. */
export interface PreseasonFeatures {
  /** Task 1 — expected games played, as a distribution, instead of seventeen for everybody. */
  readonly availability: boolean;
  /** Task 2 — the offseason transaction log, composed through Phase 3's redistribution. */
  readonly offseason: boolean;
  /** Task 3 — rookies, from draft capital and landing spot. Without it they are simply absent. */
  readonly rookies: boolean;
}

/** What a board looks like with none of this phase's work in it: the `before` arm of every ablation. */
export const NO_PRESEASON_FEATURES: PreseasonFeatures = { availability: false, offseason: false, rookies: false };
export const ALL_PRESEASON_FEATURES: PreseasonFeatures = { availability: true, offseason: true, rookies: true };

/**
 * WHAT THE BOARD ACTUALLY SHIPS WITH, and what each group measured to earn or fail to earn it.
 * Numbers from `docs/research/2026-08-27-preseason-board.md`, on the two held-out seasons.
 *
 * Kept separate from `ALL_PRESEASON_FEATURES` because they are different claims, exactly as
 * `model/features.ts` keeps them apart: that constant is "what if everything were on", this is
 * "what the measurements said to keep".
 */
export const SHIPPED_PRESEASON_FEATURES: PreseasonFeatures = {
  /**
   * ON. `rho 0.6408 -> 0.6559` in 2023 and `0.6573 -> 0.7075` in 2024 against a board that assumes
   * seventeen games for everybody, which is what a site publishing season points without a games
   * column is doing. Positive on two independent seasons and larger than any single feature Phase 3
   * measured. This is the phase's result.
   */
  availability: true,
  /**
   * ON, and it earns almost nothing. On the players whose situation changed it measured
   * `0.7081 -> 0.7086` in 2023 and `0.7248 -> 0.7258` in 2024: the right sign twice and a
   * thousandth of a point both times. It ships because it is free — it composes machinery that
   * already exists and the transaction log it needs is ingested for the board anyway — and because
   * the reasons it attaches are the explanation surface, which is the product. It is NOT claimed as
   * an accuracy gain, and Phase 3's verdict on redistribution stands.
   */
  offseason: true,
  /**
   * ON, DESPITE MEASURING WORSE THAN THE THING IT REPLACES, and this is the one flag in the engine
   * that ships on a negative number. Judged on the rookie segment against ranking the class by
   * draft pick alone it measured `0.6374 -> 0.3733` in 2023 and `0.6790 -> 0.6459` in 2024: worse
   * on both seasons, badly so on one.
   *
   * It ships because the alternative is not "rank rookies by draft capital", it is "have no rookies
   * on the board at all" — `modelProjection` cannot emit a line for a player with no usage history,
   * so switching this off removes the entire class. A board a manager cannot draft Bijan Robinson
   * from is not usable at any accuracy. The honest statement is that rookies are ON the board and
   * ORDERED BADLY, the research document says so in bold, and the fix named there is to be measured
   * on the fit seasons before the held-out ones are looked at again.
   */
  rookies: true,
};

export interface PreseasonPriors {
  readonly model: ModelPriors;
  readonly availability: AvailabilityPriors;
  readonly rookies: RookiePriors;
}

/** Everything one season's board is built from, read once, all through the same gate. */
export interface PreseasonInputs {
  readonly season: number;
  /** The last instant before anything about this season became knowable. */
  readonly moment: Date;
  readonly roster: readonly PreseasonRosterRow[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly history: readonly SeasonStatLine[];
  readonly usage: readonly PlayerWeekUsage[];
  readonly priorPlayerTeams: readonly PlayerWeekTeam[];
  readonly teamObservations: readonly TeamWeekObservation[];
  /** Games appeared in, per prior season, per player. The availability model's evidence. */
  readonly gamesPlayed: ReadonlyMap<number, ReadonlyMap<string, number>>;
}

/** How many prior seasons of usage and outcomes a preseason board reads. */
export const HISTORY_SEASONS = 3;

/**
 * THE PRESEASON MOMENT: the last instant before anything about `season` was knowable.
 *
 * One millisecond before the earliest stamp the season carries, rather than at it. Phase 5's replay
 * used the earliest stamp itself, which admits the first game's numbers — a single game out of two
 * hundred and seventy, so it made no measurable difference there, but "the board may see nothing
 * dated after the opener" is a claim this phase makes in bold and it should be true rather than
 * nearly true.
 *
 * Derived from the store rather than from a calendar, following `replay-moments.ts`: the honest
 * moment is a fact about the real world, and a date computed from nowhere would be a guess dressed
 * as a guarantee. A season absent from the store is refused rather than defaulted.
 */
export async function preseasonMomentFor(db: ReadonlyDb, season: number): Promise<Date> {
  const [row] = await db
    .select({ earliest: min(playerWeekObservations.asOf) })
    .from(playerWeekObservations)
    .where(eq(playerWeekObservations.season, season));
  const earliest = row?.earliest ?? null;
  if (earliest === null) {
    throw new Error(
      `The store holds no observations for ${season}, so its preseason moment cannot be derived. Run \`npm run projections:backfill\` first.`,
    );
  }
  return new Date(new Date(earliest).getTime() - 1);
}

/**
 * Refuses to build a board that can see the season it is predicting.
 *
 * The structural test model v1 relies on is that a week-2 replay is byte-identical before and after
 * later weeks are written into the store. This is the preseason equivalent, and it runs on every
 * board rather than only in a test: a leak here would not fail anything, it would simply make the
 * scoreboard improve, and nothing else in the suite would notice.
 */
async function assertNothingFromTheSeasonIsVisible(db: ReadonlyDb, season: number, moment: Date): Promise<void> {
  const [row] = await db
    .select({ earliest: min(playerWeekObservations.asOf) })
    .from(playerWeekObservations)
    .where(and(eq(playerWeekObservations.season, season)));
  const earliest = row?.earliest ?? null;
  if (earliest !== null && new Date(earliest) <= moment) {
    throw new Error(
      `A ${season} preseason board taken at ${moment.toISOString()} can see a ${season} observation stamped ${new Date(earliest).toISOString()}. The board would be reading the season it is predicting.`,
    );
  }
}

/** How many games each player appeared in, per season, from the store's own opportunity rows. */
async function gamesPlayedBySeason(
  db: ReadonlyDb,
  seasons: readonly number[],
  asOf: Date,
): Promise<ReadonlyMap<number, ReadonlyMap<string, number>>> {
  const bySeason = new Map<number, Map<string, number>>();
  for (const season of seasons) {
    const rows = await usageAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.playerId, (counts.get(row.playerId) ?? 0) + 1);
    bySeason.set(season, counts);
  }
  return bySeason;
}

/** Reads one whole preseason, every row of it through the same gate. */
export async function loadPreseason(db: ReadonlyDb, season: number): Promise<PreseasonInputs> {
  const moment = await preseasonMomentFor(db, season);
  await assertNothingFromTheSeasonIsVisible(db, season, moment);

  const roster = await preseasonRostersAsOf(db, { season, asOf: moment });
  if (roster.length === 0) {
    throw new Error(
      `The store holds no ${season} week-one roster knowable at ${moment.toISOString()}. Run \`npm run projections:preseason:ingest\` first.`,
    );
  }
  const positions = await allPositions(db);

  const history: SeasonStatLine[] = [];
  const usage: PlayerWeekUsage[] = [];
  const priorPlayerTeams: PlayerWeekTeam[] = [];
  const teamObservations: TeamWeekObservation[] = [];
  const priorSeasons: number[] = [];
  for (let prior = season - HISTORY_SEASONS; prior <= season - 1; prior += 1) {
    priorSeasons.push(prior);
    const span = { season: prior, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: moment } as const;
    history.push(...(await statLinesAsOf(db, span)));
    usage.push(...(await usageAsOf(db, span)));
    priorPlayerTeams.push(...(await playerTeamsAsOf(db, span)));
    teamObservations.push(...(await teamObservationsAsOf(db, span)));
  }
  // The target season's own team facts, bounded by the gate alone. Everything the schedule
  // published in May passes; everything stamped at kickoff does not. That asymmetry is the entire
  // reason `team_week_observations.as_of` exists, and it is what carries a new head coach onto the
  // board without carrying his week-one closing line with him.
  teamObservations.push(
    ...(await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: moment })),
  );

  return {
    season,
    moment,
    roster,
    positions,
    history,
    usage,
    priorPlayerTeams,
    teamObservations,
    gamesPlayed: await gamesPlayedBySeason(db, priorSeasons, moment),
  };
}

/** The team each player finished the prior season on, from the last week the store holds for him. */
function lastSeasonTeams(priorPlayerTeams: readonly PlayerWeekTeam[], season: number): ReadonlyMap<string, string> {
  const best = new Map<string, { season: number; week: number }>();
  const team = new Map<string, string>();
  for (const row of priorPlayerTeams) {
    if (row.season >= season) continue;
    const known = best.get(row.playerId);
    if (known !== undefined && (known.season > row.season || (known.season === row.season && known.week >= row.week))) continue;
    best.set(row.playerId, { season: row.season, week: row.week });
    team.set(row.playerId, row.team);
  }
  return team;
}

/**
 * The recency-weighted share a player held with his old team last season.
 *
 * The same quantity `detectTransactions` computes for an in-season departure, taken over the whole
 * prior season instead of a six-week window, because that is the whole of what he did there.
 */
function priorSeasonShares(usage: readonly PlayerWeekUsage[], season: number): ReadonlyMap<string, { targetShare: number; carryShare: number; snapShare: number; weeks: number }> {
  const totals = new Map<string, { target: number; carry: number; snap: number; weeks: number }>();
  for (const row of usage) {
    if (row.season !== season - 1) continue;
    const running = totals.get(row.playerId) ?? { target: 0, carry: 0, snap: 0, weeks: 0 };
    running.target += row.targetShare ?? 0;
    running.carry += row.carryShare ?? 0;
    running.snap += row.snapShare ?? 0;
    running.weeks += 1;
    totals.set(row.playerId, running);
  }
  return new Map(
    [...totals.entries()].map(([playerId, running]) => [
      playerId,
      {
        targetShare: running.target / running.weeks,
        carryShare: running.carry / running.weeks,
        snapShare: running.snap / running.weeks,
        weeks: running.weeks,
      },
    ]),
  );
}

/** Everyone who moved, retired or arrived across the offseason, with the work they took with them. */
export function offseasonMovesFrom(inputs: PreseasonInputs): readonly OffseasonMove[] {
  const from = lastSeasonTeams(inputs.priorPlayerTeams, inputs.season);
  const shares = priorSeasonShares(inputs.usage, inputs.season);
  const to = new Map(inputs.roster.map((row) => [row.playerId, row.status === "off_roster" ? null : row.team] as const));
  const moves: OffseasonMove[] = [];
  const seen = new Set<string>();

  const push = (playerId: string): void => {
    if (seen.has(playerId)) return;
    seen.add(playerId);
    const position = inputs.positions.get(playerId);
    if (position === undefined) return;
    const share = shares.get(playerId) ?? { targetShare: 0, carryShare: 0, snapShare: 0, weeks: 0 };
    moves.push({
      playerId,
      position,
      from: from.get(playerId) ?? null,
      to: to.get(playerId) ?? null,
      targetShare: share.targetShare,
      carryShare: share.carryShare,
    });
  };

  for (const playerId of from.keys()) push(playerId);
  for (const playerId of to.keys()) push(playerId);
  return moves.sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/** Each team's returning roster, as `redistributeShares` needs to see it. */
function returningRosters(
  inputs: PreseasonInputs,
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
): ReadonlyMap<string, readonly RosterPlayer[]> {
  const byTeam = new Map<string, RosterPlayer[]>();
  for (const row of inputs.roster) {
    if (row.status === "off_roster") continue;
    const position = inputs.positions.get(row.playerId);
    const predicted = opportunity.get(row.playerId);
    if (position === undefined || predicted === undefined) continue;
    const roster = byTeam.get(row.team) ?? [];
    roster.push({
      playerId: row.playerId,
      position,
      snapShare: predicted.snapShare,
      // No in-season weeks apart exist across an offseason, so there is never direct evidence of
      // what a teammate does when this man sits. `absorptionWeights` falls back to affinity times
      // depth chart, which is the honest answer and the only one available in August.
      upliftWhenAbsent: null,
    });
    byTeam.set(row.team, roster);
  }
  return byTeam;
}

function applyDeltas(
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
  deltas: ReadonlyMap<string, ShareDelta>,
): ReadonlyMap<string, PredictedOpportunity> {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return new Map(
    [...opportunity].map(([playerId, player]) => {
      const delta = deltas.get(playerId);
      if (delta === undefined) return [playerId, player] as const;
      return [
        playerId,
        {
          ...player,
          targetShare: clamp(player.targetShare + delta.targetShare),
          carryShare: clamp(player.carryShare + delta.carryShare),
        },
      ] as const;
    }),
  );
}

/**
 * How much of his position group's target and carry work the returning roster already holds, per
 * team and position. The competition a rookie is landing into.
 */
export function incumbentClaims(
  inputs: PreseasonInputs,
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
): ReadonlyMap<string, number> {
  const claims = new Map<string, number>();
  for (const row of inputs.roster) {
    if (row.status === "off_roster") continue;
    const position = inputs.positions.get(row.playerId);
    const predicted = opportunity.get(row.playerId);
    if (position === undefined || predicted === undefined) continue;
    const key = `${row.team}|${position}`;
    const share = position === "QB" ? predicted.passAttemptShare : predicted.targetShare + predicted.carryShare;
    claims.set(key, (claims.get(key) ?? 0) + share);
  }
  return claims;
}

/**
 * BUILDING ONE SEASON'S BOARD CANDIDATES.
 *
 * The order is the order the model itself uses and it matters: scheme sizes the pie, then the
 * offseason decides who eats it. Doing it the other way would apply a redistribution to a volume it
 * was never measured against, which is the note `model/source.ts` leaves for exactly this reason.
 */
export function preseasonCandidates(
  inputs: PreseasonInputs,
  features: PreseasonFeatures,
  priors: PreseasonPriors,
): readonly BoardCandidate[] {
  const week = 1;
  const rosterByPlayer = new Map(inputs.roster.map((row) => [row.playerId, row] as const));
  // The team context a preseason projection reads. `playerTeams` holds ONLY this season's week-one
  // roster, not last season's weeks: `latestTeams` picks the highest week number it is shown and
  // does not compare seasons, so mixing the two would hand every feature last December's employer.
  // This is the transaction wire model v2 said was missing, arriving before the season instead of a
  // Sunday after it.
  const teamContext: TeamContext = {
    playerTeams: inputs.roster
      .filter((row) => row.status !== "off_roster")
      .map((row) => ({ season: inputs.season, week, playerId: row.playerId, team: row.team, asOf: row.asOf })),
    teamObservations: inputs.teamObservations,
  };
  const input: ProjectionInput = {
    season: inputs.season,
    week,
    asOf: inputs.moment,
    // EMPTY, and not for want of plumbing. An injury designation is a fact about one game, filed in
    // the week of that game; there is no August filing for a season that has not started. Passing
    // anything here would either leak a September fact into an August board or misrepresent a
    // one-game designation as a season-long one. `news` is off in PRESEASON_MODEL_FEATURES for the
    // same reason, so this is belt and braces on a leak that would be easy to introduce later.
    news: [],
    history: inputs.history,
    usage: inputs.usage,
    positions: inputs.positions,
    teamContext,
  };

  const base = predictOpportunity(inputs.usage, { season: inputs.season, week, positions: inputs.positions }, priors.model.opportunity);
  const schemed = contextualiseOpportunity(base, input, PRESEASON_MODEL_FEATURES, priors.model.context);

  const moves = offseasonMovesFrom(inputs);
  const rosters = returningRosters(inputs, schemed);
  const deltas = features.offseason
    ? offseasonDeltas({ moves, rosters, absorptionRate: priors.model.context.redistribution.absorptionRate })
    : new Map<string, ShareDelta>();
  const opportunity = applyDeltas(schemed, deltas);

  const rates = contextualiseRates(
    predictRates(inputs.history, inputs.usage, { season: inputs.season, week, positions: inputs.positions }, priors.model.efficiency),
    input,
    PRESEASON_MODEL_FEATURES,
    priors.model.context,
  );

  const metrics = indexTeamMetrics(teamContext);
  const newPlayCaller = (team: string): boolean =>
    metrics(team, { season: inputs.season, week }, COACH_METRICS.tenureSeasons) === 0;

  const historyFor = (playerId: string): readonly SeasonAvailability[] => {
    const seasons: SeasonAvailability[] = [];
    for (const [season, counts] of inputs.gamesPlayed) {
      const played = counts.get(playerId);
      if (played === undefined) continue;
      seasons.push({ season, gamesPlayed: played, teamGames: teamGamesIn(season) });
    }
    return seasons;
  };

  const candidates: BoardCandidate[] = [];
  const claims = incumbentClaims(inputs, opportunity);
  const movesByPlayer = new Map(moves.map((move) => [move.playerId, move] as const));

  const emit = (
    playerId: string,
    position: Position,
    team: string,
    predicted: PredictedOpportunity,
    reasons: readonly BoardReason[],
  ): void => {
    const roster = rosterByPlayer.get(playerId);
    if (roster === undefined || roster.status === "off_roster") return;
    const playerRates = rates.get(playerId) ?? priors.model.efficiency.byPosition[position];
    const perGame: StatLine = composeStatLine(playerId, week, predicted, playerRates);
    const games = features.availability
      ? expectedGamesPlayed(
          {
            position,
            age: ageAtSeason(roster.birthDate, inputs.season),
            status: roster.status,
            projectedSnapShare: predicted.snapShare,
            history: historyFor(playerId),
          },
          { season: inputs.season, priors: priors.availability },
        )
      : seventeenGamesForEveryone(inputs.season);

    const all: BoardReason[] = [...reasons];
    if (features.availability) {
      all.push({
        code: "availability",
        expectedGames: games.expected,
        floorGames: games.distribution.floor,
        ceilingGames: games.distribution.ceiling,
      });
    }
    if (newPlayCaller(team)) all.push({ code: "new_play_caller", team });
    candidates.push({ playerId, position, team, perGame, games, reasons: all });
  };

  for (const [playerId, predicted] of opportunity) {
    const position = inputs.positions.get(playerId);
    const roster = rosterByPlayer.get(playerId);
    if (position === undefined || roster === undefined) continue;
    const reasons: BoardReason[] = [];
    const move = movesByPlayer.get(playerId);
    if (move !== undefined && move.from !== null && move.to !== null && move.from !== move.to) {
      reasons.push({ code: "changed_team", from: move.from, to: move.to });
    }
    const delta = deltas.get(playerId);
    if (delta !== undefined && (Math.abs(delta.targetShare) > 0 || Math.abs(delta.carryShare) > 0)) {
      reasons.push(
        delta.targetShare + delta.carryShare >= 0
          ? { code: "offseason_share_gained", targetShare: delta.targetShare, carryShare: delta.carryShare }
          : { code: "offseason_share_lost", targetShare: -delta.targetShare, carryShare: -delta.carryShare },
      );
    }
    emit(playerId, position, roster.team, predicted, reasons);
  }

  if (features.rookies) {
    for (const roster of inputs.roster) {
      if (roster.status === "off_roster") continue;
      if (roster.draftYear !== inputs.season) continue;
      if (opportunity.has(roster.playerId)) continue;
      const position = projectedPosition(roster.position) ?? inputs.positions.get(roster.playerId);
      if (position === undefined) continue;
      const rookieInput = {
        playerId: roster.playerId,
        position,
        team: roster.team,
        overallPick: roster.draftPick,
        incumbentClaim: claims.get(`${roster.team}|${position}`) ?? 0,
      };
      emit(roster.playerId, position, roster.team, rookieOpportunity(rookieInput, priors.rookies), [
        {
          code: "rookie",
          overallPick: roster.draftPick,
          landingMultiplier: landingMultiplier(rookieInput, priors.rookies),
        },
      ]);
    }
  }

  return candidates.sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/** Which players this season's offseason changed the situation of. The segment Task 2 is judged on. */
export function offseasonSegmentFor(inputs: PreseasonInputs, priors: PreseasonPriors): ReadonlySet<string> {
  const base = predictOpportunity(inputs.usage, { season: inputs.season, week: 1, positions: inputs.positions }, priors.model.opportunity);
  return changedSituationSegment(offseasonMovesFrom(inputs), returningRosters(inputs, base));
}

/** This season's rookie class, on a week-one roster. The segment Task 3 is judged on. */
export function rookieSegmentFor(inputs: PreseasonInputs): ReadonlySet<string> {
  return new Set(
    inputs.roster
      .filter((row) => row.status !== "off_roster" && row.draftYear === inputs.season)
      .map((row) => row.playerId),
  );
}

/** Where each rookie's draft capital put him, for the research document's own breakdown. */
export function rookieDraftBuckets(inputs: PreseasonInputs): ReadonlyMap<string, string> {
  return new Map(
    inputs.roster
      .filter((row) => row.draftYear === inputs.season)
      .map((row) => [row.playerId, draftBucketFor(row.draftPick)] as const),
  );
}

/**
 * THE MOMENT A FIT READS AT — far past any correction, and deliberately NOT a preseason moment.
 *
 * The point-in-time gate governs what a MODEL may see when it predicts. A fit is not predicting: it
 * is measuring what happened in seasons that are over, and the honest read of a completed season is
 * the final corrected one. `projection-fit.ts` and `nflverse/ingest.ts` both make the same choice
 * for the same reason, and both name the constant so it cannot be mistaken for a gate.
 *
 * The fence that matters is the other one, and it is in `fit.ts`: the held-out seasons are passed
 * explicitly and the fit throws if it is handed one.
 */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/**
 * One season of availability labels: who was on a week-one roster, and how many games he then
 * played.
 *
 * The population is the week-one roster rather than everyone who appeared, and that is the whole
 * design. Fitting on players who appeared would condition on the outcome — a man who missed the
 * season would be absent from his own label — and the model would learn that everybody plays
 * fifteen games.
 */
export async function loadAvailabilityObservations(
  db: ReadonlyDb,
  seasons: readonly number[],
  priors: ModelPriors = FITTED_MODEL,
): Promise<readonly AvailabilityObservation[]> {
  const positions = await allPositions(db);
  const earliest = Math.min(...seasons) - HISTORY_SEASONS;
  const latest = Math.max(...seasons);
  const spanSeasons = Array.from({ length: latest - earliest + 1 }, (_, index) => earliest + index);
  const gamesPlayed = await gamesPlayedBySeason(db, spanSeasons, FINAL_OUTCOME);

  const observations: AvailabilityObservation[] = [];
  for (const season of seasons) {
    const roster = await preseasonRostersAsOf(db, { season, asOf: FINAL_OUTCOME });
    // Role comes from the same preseason inputs a board would have had, never from the completed
    // season: a term fitted against a snap share the season itself produced would be fitted against
    // a quantity that does not exist in August.
    const inputs = await loadPreseason(db, season);
    const opportunity = predictOpportunity(inputs.usage, { season, week: 1, positions }, priors.opportunity);
    for (const row of roster) {
      const position = positions.get(row.playerId);
      if (position === undefined) continue;
      const history: SeasonAvailability[] = [];
      for (let prior = season - HISTORY_SEASONS; prior <= season - 1; prior += 1) {
        const played = gamesPlayed.get(prior)?.get(row.playerId);
        if (played === undefined) continue;
        history.push({ season: prior, gamesPlayed: played, teamGames: teamGamesIn(prior) });
      }
      observations.push({
        season,
        playerId: row.playerId,
        position,
        age: ageAtSeason(row.birthDate, season),
        status: row.status,
        projectedSnapShare: opportunity.get(row.playerId)?.snapShare ?? 0,
        history,
        gamesPlayed: gamesPlayed.get(season)?.get(row.playerId) ?? 0,
      });
    }
  }
  return observations;
}

/**
 * One season of rookie labels: draft capital, the room he landed in, and the shares he then took.
 *
 * The incumbent claim is computed from the SAME preseason inputs a board would have had, so the
 * competition term is fitted against the number it will later be evaluated at. Computing it from
 * the completed season instead would fit the term against a quantity that does not exist in August.
 */
export async function loadRookieObservations(
  db: ReadonlyDb,
  seasons: readonly number[],
  priors: ModelPriors,
): Promise<readonly RookieObservation[]> {
  const observations: RookieObservation[] = [];
  for (const season of seasons) {
    const inputs = await loadPreseason(db, season);
    const base = predictOpportunity(inputs.usage, { season, week: 1, positions: inputs.positions }, priors.opportunity);
    const claims = incumbentClaims(inputs, base);
    const actual = await usageAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });

    const played = new Map<string, { snap: number; target: number; carry: number; pass: number; weeks: number }>();
    for (const row of actual) {
      const running = played.get(row.playerId) ?? { snap: 0, target: 0, carry: 0, pass: 0, weeks: 0 };
      running.snap += row.snapShare ?? 0;
      running.target += row.targetShare ?? 0;
      running.carry += row.carryShare ?? 0;
      running.pass += row.passAttemptShare ?? 0;
      running.weeks += 1;
      played.set(row.playerId, running);
    }

    for (const row of inputs.roster) {
      if (row.status === "off_roster" || row.draftYear !== season) continue;
      const position = projectedPosition(row.position) ?? inputs.positions.get(row.playerId);
      if (position === undefined) continue;
      const totals = played.get(row.playerId);
      observations.push({
        season,
        playerId: row.playerId,
        position,
        overallPick: row.draftPick,
        incumbentClaim: claims.get(`${row.team}|${position}`) ?? 0,
        shares:
          totals === undefined || totals.weeks === 0
            ? null
            : {
                snapShare: totals.snap / totals.weeks,
                targetShare: totals.target / totals.weeks,
                carryShare: totals.carry / totals.weeks,
                passAttemptShare: totals.pass / totals.weeks,
              },
      });
    }
  }
  return observations;
}
