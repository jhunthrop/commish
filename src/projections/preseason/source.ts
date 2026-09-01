import { and, eq, min, notInArray } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import type { Clock } from "@/domain/timing";
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
import {
  firstKickoffFor,
  playerTeamsAsOf,
  teamObservationsAsOf,
  type PlayerWeekTeam,
  type TeamWeekObservation,
} from "../team-store";
import type { TeamContext } from "../team-context";
import { admitTouchesAsOpportunity, usageAsOf, type PlayerWeekUsage } from "../usage";
import { projectedPosition } from "../nflverse/players";
import { COACH_METRICS } from "../nflverse/coaches";
import { SCHEDULE_SOURCE } from "../nflverse/schedule";
import { indexTeamMetrics } from "../team-context";
import { discoveryFactsForSeason, type DiscoveryFacts } from "../laws/discovery-facts";
import { factsForSeason, type LawConditionFacts } from "../laws/populations";
import { lawReasonsFor } from "../laws/board-reasons";
import { registry } from "../laws/registry";
import type { Law } from "../laws/types";
import { LIVE_ADMITTED_DERIVED_SEASONS } from "../nflverse/stat-lines";
import { statLinesAsOfForMeasurement } from "../nflverse/derived-stat-lines";
import {
  ageAtSeason,
  expectedGamesPlayed,
  seventeenGamesForEveryone,
  teamGamesIn,
  type AvailabilityPriors,
  type SeasonAvailability,
} from "./availability";
import { scaleStatLine, type BoardCandidate, type BoardReason } from "./board";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import type { AvailabilityObservation, CareerObservation, DepthObservation, RookieObservation } from "./fit";
import { INJURY_SOURCE } from "../news/retrieve";
import { observationsAsOf } from "../store";
import { applyCareerStage, experienceBandFor, NEUTRAL_CAREER_PRIORS, type CareerPriors } from "./career";
import {
  applyDepthChart,
  depthRankFor,
  DEPTH_METRIC,
  DEPTH_SOURCE,
  type DepthChart,
  type DepthPriors,
} from "./depth";
import { changedSituationSegment, offseasonDeltas, type OffseasonMove } from "./offseason";
import {
  capitalGameRate,
  draftBucketFor,
  landingMultiplier,
  rookieOpportunity,
  type RookieFeatures,
  type RookiePriors,
} from "./rookies";
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
  /** Task 3 — rookies, from draft capital. Without it they are simply absent from the board. */
  readonly rookies: boolean;
  /** The rookie landing-spot term. Measured worse than draft capital alone; OFF on the board. */
  readonly rookieLanding: boolean;
  /** The rookie capital table interpolated on the pick axis, so a class orders by draft capital. */
  readonly rookiePickCurve: boolean;
  /** The published week-one depth chart, applied to layer 1's belief about who plays. */
  readonly depthChart: boolean;
  /** The career-stage curve, applied to the composed per-game line. See `career.ts`. */
  readonly careerStage: boolean;
}

/** What a board looks like with none of this phase's work in it: the `before` arm of every ablation. */
export const NO_PRESEASON_FEATURES: PreseasonFeatures = {
  availability: false,
  offseason: false,
  rookies: false,
  rookieLanding: false,
  rookiePickCurve: false,
  depthChart: false,
  careerStage: false,
};
export const ALL_PRESEASON_FEATURES: PreseasonFeatures = {
  availability: true,
  offseason: true,
  rookies: true,
  rookieLanding: true,
  rookiePickCurve: true,
  depthChart: true,
  careerStage: true,
};

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
   * ON, and it has to be: switching it off does not fall back to some other rookie ordering, it
   * removes the entire class from the board, because `modelProjection` cannot emit a line for a
   * player with no usage history. A board a manager cannot draft Bijan Robinson from is not usable
   * at any accuracy. What the two flags below decide is HOW the class is ordered.
   */
  rookies: true,
  /**
   * OFF, and it is the only flag in this engine turned off by a measurement rather than never
   * turned on. Judged on the rookie segment against ranking the class by draft pick alone, the
   * board carrying this term scored `0.6374 -> 0.3733` in 2023 and `0.6790 -> 0.6459` in 2024:
   * worse on both held-out seasons, badly so on one.
   *
   * The argument for it was never silly — a back landing behind a three-hundred-carry starter is
   * not the same asset as one walking into an empty room — but the term is bounded to half in
   * either direction, which is enough to move a first-round back below a third-round one, and the
   * measurement says that reordering destroys more information than it adds. The mechanism is kept,
   * behind this flag, so the next attempt at it starts from a working implementation and a number.
   */
  rookieLanding: false,
  /**
   * ON. The fitted table has six cells and a draft has two hundred and sixty picks, and the fit's
   * own monotonicity cap flattens neighbouring cells into exact ties, so a bucket-only board hands
   * a whole round one number and lets the availability model break it. Interpolating the fitted
   * means on the pick axis restores the ordering the counterfactual uses, changes no fitted value,
   * and is developed on the fit seasons. See the research document for what it measured.
   *
   * Task 4: the interpolation now moves in POINTS space (`rookies.ts`'s `capitalCurveWeight`,
   * backed by `rookie-curve.ts`) rather than in raw pick space. The measurement above predates that
   * change and describes the original linear-in-pick blend; it has not been re-run against the
   * curve-shaped one.
   */
  rookiePickCurve: true,
  /**
   * ON, and it is the answer to the deep band. `docs/research/2026-08-27-preseason-board.md` lost
   * ranks 151 to 400 on both held-out seasons and named published depth charts as one of the three
   * things consensus reads that we did not. See `depth.ts` for the mechanism and the research
   * document for what it measured on the band it targets.
   */
  depthChart: true,
  /**
   * ON, and it is the first thing this board has ever shipped that moved the STARTER band on both
   * held-out seasons. Measured on top of everything else, `docs/research/2026-08-28-starter-band.md`:
   * the starter band goes 0.2339 -> 0.2485 in 2023 and 0.2290 -> 0.2685 in 2024, the market
   * population goes 0.4697 -> 0.4759 and 0.3992 -> 0.4186, and the consensus population goes
   * 0.6489 -> 0.6659 and 0.7594 -> 0.7598.
   *
   * WHAT IT IS NOT, stated here because the headline is better than the whole truth. On the FULL
   * board — every man the engine projects, not the four hundred a benchmark also ranked — the
   * pooled figure is +0.0117 in 2023 and -0.0001 in 2024. It is a band-level effect on the players
   * a manager actually drafts, exactly as model v3 found the news pass to be, and it does not move
   * a five-hundred-row pooled correlation in 2024 at all. The elite and fringe bands are mixed.
   */
  careerStage: true,
};

export interface PreseasonPriors {
  readonly model: ModelPriors;
  readonly availability: AvailabilityPriors;
  readonly rookies: RookiePriors;
  readonly depth: DepthPriors;
  readonly career: CareerPriors;
}

/** Everything one season's board is built from, read once, all through the same gate. */
export interface PreseasonInputs {
  readonly season: number;
  /** The last instant before anything about this season became knowable. */
  readonly moment: Date;
  /** Which arm of `BoardMoment` `moment` came from — `"replay"` for every board this engine has
   *  ever built, `"live"` for one taken before the season it projects has even kicked off. Carried
   *  through so a downstream reader (the persisted `moment_kind` column, the scorecard's own
   *  `assertGradableMoment`) never has to re-derive or guess which kind of claim a board is. */
  readonly momentKind: BoardMoment["kind"];
  readonly roster: readonly PreseasonRosterRow[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly history: readonly SeasonStatLine[];
  readonly usage: readonly PlayerWeekUsage[];
  readonly priorPlayerTeams: readonly PlayerWeekTeam[];
  readonly teamObservations: readonly TeamWeekObservation[];
  /** Games appeared in, per prior season, per player. The availability model's evidence. */
  readonly gamesPlayed: ReadonlyMap<number, ReadonlyMap<string, number>>;
  /** Where each club put each man on its published week-one depth chart. Empty before ingestion. */
  readonly depthChart: DepthChart;
  /** The registry every "law" reason (`preseasonCandidates`) is drawn against — only its CONFIRMED
   *  entries ever speak, per `lawReasonsFor`'s own filter. Defaults to `registry()`; a caller building
   *  candidates for a test passes its own fixture through `loadPreseason`'s own parameter instead. */
  readonly laws: readonly Law[];
  /** Every TRIBAL law's condition inputs for season - 1 — the last COMPLETED season — gated at THIS
   *  season's own schedule publication (`laws/populations.ts`'s `factsForSeason`), which is exactly
   *  what a board for THIS season is entitled to know. Keyed by player id; a player absent here has
   *  no evidence for any tribal law, not evidence that every tribal law's condition is false.
   *
   *  `admitDerived` is `false` for a REPLAY board, always — see `admitsDerivedPriorSeason`'s own
   *  docblock (Task 4) for the ONE narrow exception a LIVE board's own prior season can hit. */
  readonly lawFacts: ReadonlyMap<string, LawConditionFacts>;
  /** Every DISCOVERED law's condition inputs for the SAME season - 1, read through the identical
   *  gate and the SAME `admitDerived` value `lawFacts` above was built with
   *  (`laws/discovery-facts.ts`'s `discoveryFactsForSeason`) — a discovered law's own live-board
   *  magnitude is admitted or refused by the identical rule a tribal law's is, so the two origins
   *  can never disagree about which seasons a live board is allowed to read derived evidence for.
   *  Keyed by player id; a player absent here has no evidence for any discovered law, not evidence
   *  that every discovered law's condition is false. */
  readonly discoveryFacts: ReadonlyMap<string, DiscoveryFacts>;
}

/** How many prior seasons of usage and outcomes a preseason board reads. */
export const HISTORY_SEASONS = 3;

/**
 * THE FEEDS WHOSE FACTS PRECEDE THE GAMES THEY DESCRIBE, and which therefore cannot define the
 * preseason moment.
 *
 * This list is the difference between a gate and a tautology. The moment is one millisecond before
 * the earliest stamp the season carries, and while every feed was a record of a completed game that
 * was exactly right. The instant a PRE-GAME feed lands, it becomes the earliest stamp and the moment
 * slides to one millisecond before it — so the feed gates itself out, silently, and an ablation of
 * it measures nothing at all. That is not a hypothetical: the injury report is stamped from the
 * league's own filing, two days before the opener, and it had made itself invisible to every
 * preseason board this engine has ever built.
 *
 * A source belongs here only if its stamp is provably earlier than the game it concerns. Both of
 * these are: an injury report carries the filing timestamp the league published it at, and a
 * week-one depth chart is stamped by `firstGameDayFor` at an instant that precedes the season's
 * first kickoff by construction. Everything else is a box score and defines the moment.
 */
export const PRE_GAME_SOURCES: readonly string[] = [INJURY_SOURCE, DEPTH_SOURCE];

/**
 * THE PRESEASON MOMENT: the last instant before anything the SEASON ITSELF produced was knowable.
 *
 * One millisecond before the earliest GAME-DERIVED stamp the season carries, rather than at it.
 * Phase 5's replay used the earliest stamp itself, which admits the first game's numbers — a single
 * game out of two hundred and seventy, so it made no measurable difference there, but "the board may
 * see nothing dated after the opener" is a claim this phase makes in bold and it should be true
 * rather than nearly true.
 *
 * Derived from the store rather than from a calendar, following `replay-moments.ts`: the honest
 * moment is a fact about the real world, and a date computed from nowhere would be a guess dressed
 * as a guarantee. A season absent from the store is refused rather than defaulted.
 */
export async function preseasonMomentFor(db: ReadonlyDb, season: number): Promise<Date> {
  const earliest = await earliestGameDerivedStamp(db, season);
  if (earliest === null) {
    throw new Error(
      `The store holds no game-derived observations for ${season}, so its preseason moment cannot be derived. Run \`npm run projections:backfill\` first.`,
    );
  }
  return new Date(earliest.getTime() - 1);
}

async function earliestGameDerivedStamp(db: ReadonlyDb, season: number): Promise<Date | null> {
  const [row] = await db
    .select({ earliest: min(playerWeekObservations.asOf) })
    .from(playerWeekObservations)
    .where(
      and(
        eq(playerWeekObservations.season, season),
        notInArray(playerWeekObservations.source, [...PRE_GAME_SOURCES]),
      ),
    );
  const earliest = row?.earliest ?? null;
  return earliest === null ? null : new Date(earliest);
}

/**
 * Refuses to build a board that can see a RESULT of the season it is predicting.
 *
 * The structural test model v1 relies on is that a week-2 replay is byte-identical before and after
 * later weeks are written into the store. This is the preseason equivalent, and it runs on every
 * board rather than only in a test: a leak here would not fail anything, it would simply make the
 * scoreboard improve, and nothing else in the suite would notice.
 *
 * The claim it enforces narrowed when the pre-game feeds arrived, and narrowed honestly. It used to
 * be "nothing the season carries"; it is now "nothing the season's GAMES produced", because a
 * league injury filing and a published depth chart are things a person could read before the opener
 * and an expert consensus board demonstrably did. What the assertion still refuses outright is a
 * single box-score number, and that is the claim the scoreboard rests on.
 */
async function assertNothingFromTheSeasonIsVisible(db: ReadonlyDb, season: number, moment: Date): Promise<void> {
  const earliest = await earliestGameDerivedStamp(db, season);
  if (earliest !== null && earliest <= moment) {
    throw new Error(
      `A ${season} preseason board taken at ${moment.toISOString()} can see a ${season} game-derived observation stamped ${earliest.toISOString()}. The board would be reading the season it is predicting.`,
    );
  }
}

/**
 * TASK 2 — THE LIVE MOMENT (`docs/research/2026-08-28-live-season.md`).
 *
 * A board has always been taken at ONE moment, and until now that moment was always a REPLAY: one
 * millisecond before the earliest thing a COMPLETED season revealed, derived by `preseasonMomentFor`
 * above and asserted against by `assertNothingFromTheSeasonIsVisible`. Every backtest, every
 * published measurement and every stored row in `preseason_projections` is that arm, and this type
 * exists to make it nameable rather than to change it: the replay arm below wraps
 * `preseasonMomentFor`'s own derivation with byte-identical behaviour, nothing about it moves.
 *
 * The LIVE arm is the other honest answer to "when was this board taken": for a season that has not
 * kicked off yet, there is no completed game to derive a moment from, and the only truthful moment is
 * NOW — capped so it can never reach the season's own first kickoff, because a moment at or past
 * kickoff belongs to a season that has started, and a started season has a REPLAY moment. The two
 * arms must never be confused for each other, which is why this is a discriminated union rather than
 * a second optional field: a caller pattern-matches on `kind` rather than inferring which claim a
 * `Date` is making from context.
 */
export type BoardMoment =
  | { readonly kind: "replay"; readonly at: Date }
  | { readonly kind: "live"; readonly at: Date };

/**
 * BoardMoment IS UNFORGEABLE (fix round, C2). A hand-built `{ kind: "replay", at: new Date() }` for
 * a season that has not been played would be the THIRD leakage defect this engine has found in as
 * many phases — a live board persisted and graded as though it were a claim about a finished season
 * — and TypeScript's structural typing does nothing to stop it: any object shaped like `BoardMoment`
 * IS one, as far as the type system is concerned. This `WeakSet` is the actual enforcement.
 * `replayMomentFor` and `liveMomentFor` are the ONLY two functions that ever call `brand`, so
 * membership in this set is exactly "was returned by one of them" — a claim no import, no `as
 * BoardMoment` cast and no structurally-identical object literal can fake, because none of them can
 * reach a set this module never exports. `loadPreseason` calls `assertBranded` on any
 * caller-supplied moment before using it for anything.
 */
const BRANDED_MOMENTS = new WeakSet<BoardMoment>();

function brand(moment: BoardMoment): BoardMoment {
  BRANDED_MOMENTS.add(moment);
  return moment;
}

function assertBranded(moment: BoardMoment): void {
  if (!BRANDED_MOMENTS.has(moment)) {
    throw new Error(
      "This BoardMoment was not constructed by replayMomentFor or liveMomentFor. A hand-built moment could claim any season is a finished replay at any Date, which is exactly the leakage defect BoardMoment exists to make impossible. Construct one through replayMomentFor or liveMomentFor.",
    );
  }
}

/** The replay arm, as a `BoardMoment` — `preseasonMomentFor`'s own derivation, untouched, wrapped so
 *  a caller can hand `loadPreseason` an explicit moment without re-deriving it by hand. */
export async function replayMomentFor(db: ReadonlyDb, season: number): Promise<BoardMoment> {
  return brand({ kind: "replay", at: await preseasonMomentFor(db, season) });
}

/**
 * THE LIVE ARM'S OWN MOMENT: `min(now, one millisecond before the season's first scheduled kickoff)`.
 *
 * THROWS when `season`'s first kickoff has already passed as of `clock.now()` — a started season has
 * a REPLAY moment (`replayMomentFor`/`preseasonMomentFor` above), never a live one, and building a
 * "live" board for a season already under way would be the exact confusion `BoardMoment`'s two arms
 * exist to make impossible. THROWS when the store holds no ingested schedule for `season` at all,
 * for the same reason `preseasonMomentFor` refuses rather than defaulting: an honest moment is a fact
 * about the real world, and a moment computed with no schedule to check it against would be a guess.
 *
 * `firstKickoffFor` (fix round, I4/I5) is `team-store.ts`'s own consolidated definition — the SAME
 * one `depth.ts` and `replay-moments.ts` now read — derived from the schedule's UNCONDITIONAL
 * kickoff-instant metric rather than from a betting line, which can legitimately be absent for a
 * real scheduled game (checked against 2026: past week six, some games carry no line at all). A
 * lined-games minimum could silently return a moment AFTER the season had actually started; this
 * cannot.
 *
 * Because the throw above fires whenever `now` is at or past kickoff, the `min(...)` this function is
 * named for only ever resolves to `now` in practice — `now < kickoff` and both are integer
 * millisecond instants, so `now <= kickoff - 1` always holds once the throw has NOT fired. The `min`
 * is kept anyway because it is the honest statement of the rule ("this moment can never reach
 * kickoff"), not merely its consequence under today's guard.
 */
export async function liveMomentFor(db: ReadonlyDb, season: number, clock: Clock): Promise<BoardMoment> {
  const kickoff = await firstKickoffFor(db, season);
  if (kickoff === null) {
    throw new Error(
      `The store holds no ingested schedule for ${season}, so its live moment cannot be derived. Run \`npm run projections:context\` first.`,
    );
  }
  const now = new Date(clock.now());
  if (now.getTime() >= kickoff.getTime()) {
    throw new Error(
      `${season}'s first scheduled kickoff (${kickoff.toISOString()}) is not after ${now.toISOString()}. ${season} has already started, so it has a REPLAY moment, not a live one. Use \`replayMomentFor\`/\`preseasonMomentFor\` instead.`,
    );
  }
  const cap = new Date(kickoff.getTime() - 1);
  const at = new Date(Math.min(now.getTime(), cap.getTime()));
  return brand({ kind: "live", at });
}

/**
 * THE LIVE ARM'S OWN READ GUARD — CLASS-SCOPED (Task 3, ruling A), replacing the fix round's
 * "refuse the whole table" version. That version blocked Task 4 outright: it refused the 2026 depth
 * chart Task 3 now stamps at its own real publication instant (see `depth.ts`'s `mapDatedDepthChart`),
 * even though that chart is exactly the kind of fact a live board is supposed to be able to read.
 *
 * THE RULE NOW: a GAME-DERIVED fact about `season` is refused at ANY as-of, full stop — STRICTER than
 * the replay assertion below, and deliberately so. `assertNothingFromTheSeasonIsVisible` only refuses
 * a game-derived stamp AT OR BEFORE its moment, because a completed season's early weeks are honestly
 * in the past relative to a later preseason board. A live board has no such history to lean on: the
 * season it projects has not been played AT ALL, so a single game-derived row existing in the store —
 * at any as-of, including one that would predate the live moment itself — means the season has
 * started, full stop. `earliestGameDerivedStamp` (used by the replay assertion above, via
 * `PRE_GAME_SOURCES`'s own exclusion) is reused here for exactly that reason: the two assertions ask
 * almost the same question of the same rows, and the live arm's answer to "does one exist at all" is
 * "then refuse", never "then compare it to my moment".
 *
 * A pre-game fact (`PRE_GAME_SOURCES` — the injury wire, a published depth chart) is NOT refused by
 * this guard at all. It flows through the ORDINARY as-of gate every other reader in this engine uses,
 * at `moment = now` for the live arm exactly as at `moment = the replay instant` for the replay arm,
 * no carve-out and no special case: `depthChartAsOf` below reads it with `asOf: moment` like
 * everything else, so a pre-game row stamped before `now` is visible and one stamped after `now` is
 * simply invisible, silently, the same point-in-time discipline every reader here already carries.
 * This is what makes the fix safe rather than a loophole: nothing about the ordinary gate lets a
 * pre-game row claim knowledge from AFTER the moment it is read at, and Task 3's own stamp fix
 * (`mapDatedDepthChart` stamping a dated-schema row at its own real `dt` instead of the old
 * kickoff-eve convention) is precisely what makes that gate tell the truth for a live season's depth
 * chart, where the old convention's future-dated stamp used to make an already-published chart
 * invisible to a `now`-bounded live moment for no reason but its own stamping choice.
 *
 * WHY A PRE-GAME ROW NEEDS NO CONTAINMENT CHECK OF ITS OWN (fix round review, I2). A GAME-DERIVED
 * row's mere EXISTENCE is refused above because existing at all already proves the season started —
 * there is no honest way for a box score to exist before its game. A PRE-GAME row proves nothing of
 * the kind: `INJURY_SOURCE`'s own stamp is honest PER GAME (a filing two days before ONE game), and a
 * filing existing in the store says nothing about whether THIS SEASON has started — an injury report
 * is exactly as normal a thing to find in the store for a season still a week from kickoff as for one
 * three weeks in. So this guard could not use "does a pre-game row exist" as its containment test even
 * if it wanted to; that question has no useful answer from a pre-game row alone. The actual guarantee
 * that a live board is never looking at a started season is NOT this guard's job at all — it is
 * `liveMomentFor`'s own throw (arm 1, above: "a started season has a REPLAY moment, not a live one"),
 * which refuses to construct a live `BoardMoment` in the first place once `now` reaches the season's
 * first kickoff. By the time ANY guard below runs, containment has already been decided; this guard's
 * OWN job is narrower and different — refusing a game-derived row that should not exist yet regardless
 * of what the clock says, which is defense in depth against arm 1 having been wrong or bypassed, not a
 * second way of checking whether the season started.
 *
 * SCOPE, STATED PLAINLY (carried from the fix round's I6, still true). This guard reads
 * `player_week_observations` ONLY — the table `assertNothingFromTheSeasonIsVisible` also reads, and
 * nothing else. It says nothing about two other kinds of season-S fact `loadPreseason` reads below,
 * because each is already governed by a DIFFERENT mechanism and does not need this one:
 *   - Season-S's week-one ROSTER (`preseasonRostersAsOf`) is governed by AS-OF: it is read with
 *     `asOf: moment` like everything else, so a roster fact stamped after the live moment is simply
 *     invisible. It needs no extra refusal because it is the one thing about season S a board is
 *     explicitly ALLOWED to see, replay or live alike.
 *   - Season-S's TEAM facts (`teamObservationsAsOf`) are filtered by a ONE-ELEMENT DENYLIST, not a
 *     "source class" in the `PRE_GAME_SOURCES` sense (fix round review, M2 — the previous wording
 *     overclaimed this). The shared `.filter((observation) => observation.source !==
 *     SCHEDULE_SOURCE.kickoff)` below excludes exactly one source, `SCHEDULE_SOURCE.kickoff` (the
 *     closing line, the recorded weather), and runs identically for both arms because it is the SAME
 *     call, not because the live arm specifically needs it. For the LIVE arm this filter is actually
 *     REDUNDANT, not load-bearing: `liveMomentFor` guarantees `moment` is always strictly BEFORE the
 *     season's own kickoff, so `teamObservationsAsOf`'s own `asOf: moment` bound alone already excludes
 *     every kickoff-stamped row before the denylist filter gets a chance to. The denylist earns its
 *     keep on the REPLAY arm instead, where `moment` can legitimately land AFTER kickoff (a completed
 *     game's stat line is stamped a day and a half later, so the replay moment can sit past its own
 *     kickoff) and the moment bound alone would let a closing line through. THE LIVE ARM'S REAL SAFETY
 *     HERE IS THE MOMENT BOUND, not this filter — stated plainly so a future change to the denylist is
 *     understood as a replay-arm concern first.
 */
async function assertNoGameDerivedObservationOfTheLiveSeasonIsVisible(db: ReadonlyDb, season: number, moment: Date): Promise<void> {
  const earliest = await earliestGameDerivedStamp(db, season);
  if (earliest !== null) {
    throw new Error(
      `A ${season} LIVE board taken at ${moment.toISOString()} can see a ${season} game-derived observation stamped ${earliest.toISOString()}. A live board refuses every GAME-DERIVED observation from the season it projects, at ANY as-of, not merely ones before its own moment — a box score existing at all means the season has started, and a started season needs a REPLAY moment instead.`,
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

/**
 * `loadPreseason`'s optional inputs, as one options object (fix round, M9) rather than a growing
 * positional tail. `laws` and `boardMoment` were the second and third optional parameters before
 * this; Task 4 is expected to add at least one more (per `progress.md`'s own scoping note), and a
 * THIRD positional optional parameter is exactly the point past which a call site starts passing
 * `undefined` just to reach the one it means — `source.test.ts`'s own
 * `loadPreseason(db, LIVE_SEASON, undefined, liveMoment)` before this fix round is the example.
 */
/**
 * TASK 4 — THE LIVE PATH'S NARROW DERIVED ADMISSION (extends the C2 containment ruling `factsForSeason`
 * and `discoveryFactsForSeason` document on their own `admitDerived` parameters, per the live-board
 * plan's Part 1 ruling: "the LIVE board path may admit derived stat lines for gap seasons where NO
 * published feed exists").
 *
 * `admitDerived: false`, unconditionally, was the correct call for every board this engine had ever
 * built, because every board's prior season had a published nflverse feed to fall back on. A LIVE
 * board's prior season is no longer guaranteed that: `season - 1` can be `2025`, which
 * `nflverse/stat-lines.ts`'s `STAT_LINE_GAPS` lists as a gap season with NO published twin at
 * all — `stats_player_week_2025.csv` is still a 404, and unlike 2019 (a published year on both
 * sides of it) there is no future ingestion that will ever fill this hole, because 2025 IS the
 * season immediately behind a live 2026 board. A blanket `false` would not protect a manager from a
 * worse number here; it would silently starve every law fact for a player's 2025 season (the
 * tri-state rule reading every field `null`, "no evidence"), on a season the pbp-derived path
 * already cleared the identical 0.9999-rank / 0.28-MAE validation bar that gates every OTHER gap
 * season this engine has ever shipped a law fact from (`derivedSeasonSanityReport`,
 * `nflverse/derived-stat-lines.ts`).
 *
 * THE ADMISSION IS NARROWED TO EXACTLY `LIVE_ADMITTED_DERIVED_SEASONS` (`nflverse/stat-lines.ts`),
 * never a blanket `admitDerived: true`, and ONLY on the LIVE arm: this returns `true` only when
 * `momentKind === "live"` AND `priorSeason` is in that allowlist — deliberately NOT
 * `STAT_LINE_GAPS`, whose own docblock explains why (it also lists 2019, eleven-plus-year-old
 * history with no business reaching a live product surface). A REPLAY board's law facts are
 * UNCHANGED by this task: every published measurement in `measured.json`/`discovered.json` was fit
 * with `admitDerived: false` at this exact seam and stays exactly reproducible, because a replay
 * board never satisfies the first half of the conjunction below.
 */
/**
 * FINAL FIX ROUND (whole-branch review, H1) — RENAMED FROM `lawFactsAdmitDerived`, because the law
 * facts are no longer the only reader.
 *
 * Task 4 wired this predicate into `factsForSeason`/`discoveryFactsForSeason` and stopped there, and
 * the whole-branch review found the half that was left behind: the MODEL arm of the same live board
 * read `season - 1` through the published-only `statLinesAsOf` and through a `usageAsOf` that
 * synthesized zeros, so a 2026 live board's `predictRates` joined against an EMPTY 2025 and every one
 * of 759 players silently took the position-prior efficiency. Nothing threw, because "no evidence
 * means the prior" is the designed fallback — the failure looked exactly like a healthy board.
 *
 * The predicate itself is UNCHANGED: live arm AND an allowlisted prior season, never a blanket
 * `admitDerived: true` and never `STAT_LINE_GAPS`. What changed is that every read in `loadPreseason`
 * that consumes `season - 1` now asks it, so the board has ONE answer to "may this board see the
 * derived prior season" instead of two that disagreed.
 */
function admitsDerivedPriorSeason(momentKind: BoardMoment["kind"], priorSeason: number): boolean {
  return momentKind === "live" && LIVE_ADMITTED_DERIVED_SEASONS.includes(priorSeason);
}

export interface LoadPreseasonOptions {
  /** The registry every "law" reason is drawn against. Defaults to the real `registry()`, the same
   *  default-from-a-committed-file pattern `loadAvailabilityObservations` below takes with
   *  `FITTED_MODEL`; a test passes its own fixture registry instead. */
  readonly laws?: readonly Law[];
  /**
   * Defaults to `undefined`, which resolves to `replayMomentFor(db, season)` — BYTE-IDENTICAL to
   * every call site's behaviour before this option existed, since that is exactly
   * `preseasonMomentFor`'s own unchanged derivation wrapped in the replay arm. A caller may instead
   * hand in an explicit `BoardMoment`, constructed ONLY by `replayMomentFor` or `liveMomentFor` (see
   * `BoardMoment`'s own docblock — `assertBranded` below refuses anything else): the REPLAY arm
   * still runs `assertNothingFromTheSeasonIsVisible` unchanged; the LIVE arm runs the class-scoped
   * `assertNoGameDerivedObservationOfTheLiveSeasonIsVisible` instead (Task 3, ruling A), and every
   * read below still uses the resolved moment as its own `asOf` cutoff exactly as it always has.
   */
  readonly boardMoment?: BoardMoment;
}

/** Reads one whole preseason, every row of it through the same gate. See `LoadPreseasonOptions`
 *  for what `laws` and `boardMoment` each default to and mean. */
export async function loadPreseason(
  db: ReadonlyDb,
  season: number,
  options: LoadPreseasonOptions = {},
): Promise<PreseasonInputs> {
  const { laws = registry(), boardMoment } = options;
  if (boardMoment !== undefined) assertBranded(boardMoment);
  const resolvedMoment = boardMoment ?? (await replayMomentFor(db, season));
  const moment = resolvedMoment.at;
  if (resolvedMoment.kind === "replay") {
    await assertNothingFromTheSeasonIsVisible(db, season, moment);
  } else {
    await assertNoGameDerivedObservationOfTheLiveSeasonIsVisible(db, season, moment);
  }

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
    // THE MODEL ARM'S HALF OF THE SAME ADMISSION (final fix round, H1 — see
    // `admitsDerivedPriorSeason`). On every replay board and every published prior season this is
    // the bare `statLinesAsOf`/`usageAsOf` pair it has always been, byte for byte. On a LIVE board
    // whose prior season is allowlisted it is the derived outcome lines plus the play-by-play's own
    // touch counts standing in for the opportunity counts that season's missing weekly stats file
    // never carried — the two halves of a rate, both admitted or neither.
    const admitDerived = admitsDerivedPriorSeason(resolvedMoment.kind, prior);
    history.push(...(admitDerived ? await statLinesAsOfForMeasurement(db, span) : await statLinesAsOf(db, span)));
    const priorUsage = await usageAsOf(db, span);
    usage.push(...(admitDerived ? admitTouchesAsOpportunity(priorUsage, positions) : priorUsage));
    priorPlayerTeams.push(...(await playerTeamsAsOf(db, span)));
    teamObservations.push(...(await teamObservationsAsOf(db, span)));
  }
  // The target season's own team facts. Everything the schedule published in May passes; the
  // closing lines stamped at kickoff are refused BY SOURCE, and that refusal is code rather than
  // arithmetic on purpose.
  //
  // A SECOND LEAKAGE DEFECT OF THE SAME SHAPE AS THE FIRST, found by auditing rather than by a
  // failure. The docblock above has always said a board may not see this season's closing lines,
  // and the gate alone did not deliver it: the preseason moment is one millisecond before the
  // earliest GAME-DERIVED stamp, a box score is stamped a day and a half after its game, and a
  // closing line is now stamped at kickoff — so the moment lands on the SATURDAY and the Thursday
  // opener's two closing lines sit comfortably inside it. Nothing reads them today, because
  // `features/context.ts` builds its game context from the opponent's defensive rating and rest
  // days, which is exactly why nothing failed. It is also exactly the state the injury feed was in
  // when it silently gated itself out of every board this engine had ever built, and the betting
  // line is the next feature this board is meant to grow.
  teamObservations.push(
    ...(await teamObservationsAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: moment })).filter(
      (observation) => observation.source !== SCHEDULE_SOURCE.kickoff,
    ),
  );

  // "Season N" for every law's own condition: the completed season immediately before this one,
  // read through `factsForSeason`'s OWN gate (N+1's schedule publication — this season's), which is
  // exactly the moment a board for THIS season is entitled to know it at. The same call
  // `buildPopulations` makes for its measurement, EXCEPT the last argument: `admitDerived` here is
  // `false` for every REPLAY board (fix round, C2, unchanged) and `true` ONLY for a LIVE board whose
  // prior season is in `LIVE_ADMITTED_DERIVED_SEASONS` (Task 4 — see `admitsDerivedPriorSeason`'s own
  // docblock for the no-published-alternative justification). A live board's law reasons must never
  // drift from the evidence that confirmed the law, but they also must never render a row nflverse
  // did not itself publish OR silently starve a player of a season that had nowhere else to come
  // from — a bare `true` here would let a board whose prior season is 2019 (any board for the 2020
  // season) compute its law facts partly from pbp-derived play-by-play the validation bar never
  // checked, mixing a MEASUREMENT convenience into a number a real manager reads; the narrowed
  // allowlist is what keeps that door shut while still opening it for 2025 alone. The honest cost
  // when `admitDerived` is `false`: a board's `touches`/`touchdownPointsShare`/etc. facts for a
  // player's prior season read as `null` (no evidence) — the tri-state rule (`LawConditionFacts`'s
  // own docblock) already does the right thing with that.
  const priorSeasonAdmitDerived = admitsDerivedPriorSeason(resolvedMoment.kind, season - 1);
  const priorSeasonFacts = await factsForSeason(db, season - 1, positions, PPR_SCORING, priorSeasonAdmitDerived);
  const lawFacts = new Map([...priorSeasonFacts].map(([playerId, entry]) => [playerId, entry.facts] as const));

  // The SAME season, the SAME gate, the SAME `admitDerived` value (see `lawFacts`'s own comment just
  // above and `PreseasonInputs.discoveryFacts`'s own docblock) — a discovered law's own condition is
  // a `DiscoveryFacts` predicate, a different fact shape than a tribal law's `LawConditionFacts`, so
  // it needs its own read rather than a projection off `priorSeasonFacts`.
  // `incomingAsOf` is THIS BOARD'S OWN MOMENT (Task 3), which is the honest gate for a preseason
  // market fact about the season being projected: the replay arm is one millisecond before anything
  // this season's games produced, and the live arm is the clock, which `liveMomentFor` has already
  // proven is before the season's first kickoff. A win total published in August of `season` is
  // readable at either; nothing `season` produced on the field is readable at either. See
  // `discoveryFactsForSeason`'s own `incomingAsOf` docblock for why this cannot ride on the
  // May-of-`season` gate the rest of that read uses.
  const discoveryFacts = await discoveryFactsForSeason(db, season - 1, positions, PPR_SCORING, priorSeasonAdmitDerived, moment);

  return {
    season,
    moment,
    momentKind: resolvedMoment.kind,
    roster,
    positions,
    history,
    usage,
    priorPlayerTeams,
    teamObservations,
    gamesPlayed: await gamesPlayedBySeason(db, priorSeasons, moment),
    depthChart: await depthChartAsOf(db, season, moment),
    laws,
    lawFacts,
    discoveryFacts,
  };
}

/** The published week-one ordering, read through the same gate as everything else. */
async function depthChartAsOf(db: ReadonlyDb, season: number, asOf: Date): Promise<DepthChart> {
  const rows = await observationsAsOf(db, { season, week: 1, asOf, source: DEPTH_SOURCE });
  return new Map(
    rows
      .filter((row) => row.metric === DEPTH_METRIC)
      .map((row) => [row.playerId, depthRankFor(row.value)] as const),
  );
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
  const redistributed = applyDeltas(schemed, deltas);
  // LAST, and after the offseason rather than before it. The chart is a statement about the roster
  // that exists NOW — it already reflects every arrival and departure the offseason log is
  // reasoning about — so correcting first and redistributing afterwards would move share away from
  // a starter the club has just confirmed and toward a man it has just listed third.
  const opportunity = features.depthChart
    ? applyDepthChart(redistributed, inputs.depthChart, inputs.positions, priors.depth)
    : redistributed;

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
    /**
     * A rookie's availability baseline, from his draft capital. Null for everybody else, whose
     * baseline is the position-and-role table and whose own record is the evidence against it.
     */
    baselineRate: number | null,
  ): void => {
    const roster = rosterByPlayer.get(playerId);
    if (roster === undefined || roster.status === "off_roster") return;
    const playerRates = rates.get(playerId) ?? priors.model.efficiency.byPosition[position];
    const composed: StatLine = composeStatLine(playerId, week, predicted, playerRates);
    // LAST of the per-game corrections and BEFORE availability reads the snap share, which is the
    // only order that does not double-count. The curve is a statement about production per game;
    // the availability model is fitted on games; letting the curve move the games would apply a
    // career stage twice. `predicted.snapShare` is untouched below for exactly that reason.
    const perGame: StatLine = features.careerStage
      ? applyCareerStage(composed, position, experienceBandFor(inputs.season, roster.draftYear), priors.career)
      : composed;
    const games = features.availability
      ? expectedGamesPlayed(
          {
            position,
            age: ageAtSeason(roster.birthDate, inputs.season),
            status: roster.status,
            projectedSnapShare: predicted.snapShare,
            history: historyFor(playerId),
            baselineRate,
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
    // Task 7/8 — every CONFIRMED law, tribal or discovered, whose condition held for HIM in the
    // completed season, from the shared facts `loadPreseason` already computed once for the whole
    // board. A player absent from BOTH maps gets nothing, never a false-condition guess; absent from
    // only one still lets the OTHER origin's laws speak for him (`lawReasonsFor`'s own docblock).
    // `position` is HIS OWN position (Task 4 fix round, C1) — `lawReasonsFor` gates every law's own
    // condition against it, so a law measured on one position (`rb_age_curve`, RB-only) can never
    // speak for a different one just because `LawConditionFacts` happens to carry a value in the
    // same-named field.
    const lawFacts = inputs.lawFacts.get(playerId) ?? null;
    const discoveryFacts = inputs.discoveryFacts.get(playerId) ?? null;
    if (lawFacts !== null || discoveryFacts !== null) all.push(...lawReasonsFor(position, lawFacts, discoveryFacts, inputs.laws));
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
    emit(playerId, position, roster.team, predicted, reasons, null);
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
      const rookieFeatures: RookieFeatures = {
        landingSpot: features.rookieLanding,
        pickCurve: features.rookiePickCurve,
      };
      emit(
        roster.playerId,
        position,
        roster.team,
        rookieOpportunity(rookieInput, priors.rookies, rookieFeatures),
        [
          {
            code: "rookie",
            overallPick: roster.draftPick,
            landingMultiplier: rookieFeatures.landingSpot ? landingMultiplier(rookieInput, priors.rookies) : 1,
          },
        ],
        capitalGameRate(position, roster.draftPick, priors.rookies, rookieFeatures),
      );
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
        baselineRate: null,
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
        // Zero for a man who never dressed, which is the observation the game-rate cell exists to
        // hold. `shares` stays null for him, because he took no share of anything.
        gamesPlayed: totals?.weeks ?? 0,
        teamGames: teamGamesIn(season),
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

/**
 * One season of depth-chart labels: where his club listed him, what layer 1 thought, what he played.
 *
 * The projected share is taken from the SAME preseason inputs a board would have had, so the
 * correction is fitted against the number it will later be applied to. The actual share is over the
 * team's whole season with absences counted as zero, because the claim the chart makes is about how
 * much of the year a man is on the field and a mean over the games he dressed for would answer a
 * different question.
 */
export async function loadDepthObservations(
  db: ReadonlyDb,
  seasons: readonly number[],
  priors: ModelPriors,
): Promise<readonly DepthObservation[]> {
  const observations: DepthObservation[] = [];
  for (const season of seasons) {
    const inputs = await loadPreseason(db, season);
    const projected = predictOpportunity(
      inputs.usage,
      { season, week: 1, positions: inputs.positions },
      priors.opportunity,
    );
    const actual = await usageAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
    const played = new Map<string, number>();
    for (const row of actual) played.set(row.playerId, (played.get(row.playerId) ?? 0) + (row.snapShare ?? 0));

    const teamGames = teamGamesIn(season);
    for (const row of inputs.roster) {
      if (row.status === "off_roster") continue;
      const position = inputs.positions.get(row.playerId);
      const predicted = projected.get(row.playerId);
      if (position === undefined || predicted === undefined) continue;
      observations.push({
        season,
        playerId: row.playerId,
        position,
        rank: inputs.depthChart.get(row.playerId) ?? "offChart",
        projectedSnapShare: predicted.snapShare,
        actualSnapShare: (played.get(row.playerId) ?? 0) / teamGames,
      });
    }
  }
  return observations;
}

/**
 * One season of career-stage labels: what the board projected for a man before this curve existed,
 * and what he then scored.
 *
 * THE `before` ARM IS THE BOARD WITH EVERY OTHER SHIPPED FEATURE ON AND THIS ONE OFF, which is the
 * correction `fitStatusMultipliers` needed too: a multiplier is only a correction if it is fitted
 * against the number it multiplies. Fitting against a bare model would measure the residual of a
 * board nobody publishes.
 *
 * THE POPULATION IS EVERY MAN THE BOARD PROJECTS AND THE ABSENT ONES SCORE ZERO. A career curve
 * fitted over the players who appeared would be fitted on the subset of each cohort that turned out
 * to be good, and the rookie cell — the one with the most to gain from that selection — would be
 * the most inflated. `fit.ts` states the same thing from the other side.
 */
export async function loadCareerObservations(
  db: ReadonlyDb,
  seasons: readonly number[],
  priors: Omit<PreseasonPriors, "career">,
): Promise<readonly CareerObservation[]> {
  const observations: CareerObservation[] = [];
  for (const season of seasons) {
    const inputs = await loadPreseason(db, season);
    const candidates = preseasonCandidates(
      inputs,
      { ...SHIPPED_PRESEASON_FEATURES, careerStage: false },
      { ...priors, career: NEUTRAL_CAREER_PRIORS },
    );
    const actual = await seasonPointsFor(db, season, inputs.positions);
    const draftYear = new Map(inputs.roster.map((row) => [row.playerId, row.draftYear] as const));
    for (const candidate of candidates) {
      observations.push({
        season,
        playerId: candidate.playerId,
        position: candidate.position,
        band: experienceBandFor(season, draftYear.get(candidate.playerId) ?? null),
        projectedPoints: computeFantasyPoints(
          scaleStatLine(candidate.perGame, candidate.games.expected),
          candidate.position,
          PPR_SCORING,
        ),
        actualPoints: actual.get(candidate.playerId) ?? 0,
      });
    }
  }
  return observations;
}

/**
 * What every player actually scored over one completed regular season, in the league the board is
 * measured in. Read at `FINAL_OUTCOME`, like every other label a fit reads: a fit is not predicting.
 */
async function seasonPointsFor(
  db: ReadonlyDb,
  season: number,
  positions: ReadonlyMap<string, Position>,
): Promise<ReadonlyMap<string, number>> {
  const rows = await statLinesAsOf(db, { season, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: FINAL_OUTCOME });
  const totals = new Map<string, number>();
  for (const row of rows) {
    const position = positions.get(row.line.playerId);
    if (position === undefined) continue;
    totals.set(row.line.playerId, (totals.get(row.line.playerId) ?? 0) + computeFantasyPoints(row.line, position, PPR_SCORING));
  }
  return totals;
}

/**
 * The last week of the regular season. The span a board is scored over, and the span its labels are
 * read over, held in one place so the two can never disagree.
 */
const LAST_REGULAR_WEEK = 18;
