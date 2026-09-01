import type { ReadonlyDb } from "@/db/client";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { registry } from "../laws/registry";
import type { Law } from "../laws/types";
import { spearman, type Observation } from "../metrics";
import { scaleStatLine, type BoardCandidate, type BoardReason } from "../preseason/board";
import { rookieCurve } from "../preseason/rookie-curve";
import {
  preseasonCandidates,
  SHIPPED_PRESEASON_FEATURES,
  type PreseasonFeatures,
  type PreseasonInputs,
  type PreseasonPriors,
} from "../preseason/source";
import { FITTED_BLEND_CONSTANTS } from "./blend-fitted";
import { isCurvePosition, marketBoard, type CurvePosition, type ImpliedGamesByPosition, type MarketPriorEntry } from "./curve";

/**
 * THE BLEND — an ADP-anchored board that spends disagreement only where confirmed evidence
 * justifies it.
 *
 * Task 9's market curve (`market/curve.ts`) answers "where would twelve real fantasy managers put
 * this player." The raw model (`preseason/source.ts`'s `preseasonCandidates`) answers "what does
 * this engine's own opportunity-times-efficiency-times-games arithmetic say." Both are real signal
 * and neither is free of noise, but they are noisy in DIFFERENT places: the market is slow to move
 * off name recognition and hype, the model is a stack of six fitted layers each with its own error
 * bars. Averaging them blindly would let the model's noisiest layer move a player as far as its
 * best-measured one.
 *
 * So this module does not average. It STARTS from the market's own number (`marketPoints`) and
 * admits a delta ONLY when the model can name the specific, already-measured evidence behind it:
 * a confirmed law whose condition holds for this player, a gap between how many games the model
 * expects him to play and the market's OWN IMPLIED games-played assumption (I3+I5 fix round — see
 * `admittedDelta`'s own docblock, clause (b)), or — for a listed rookie — the draft-capital curve
 * replacing the market's own rookie-hype pricing outright. Every other layer of the model (scheme,
 * offseason redistribution, depth chart, career stage, the model's own opportunity-times-efficiency
 * arithmetic) never gets a vote here: it has already had its say by producing the `BoardReason`s
 * this module reads, and NOTHING beyond those named reasons is allowed to move a player off market.
 *
 * THE IDENTITY THIS DESIGN RESTS ON: a player with no admitted evidence — no confirmed law fired
 * for him, and his expected games exactly match the market's own implied assumption — gets
 * `marketPoints` back EXACTLY, not "close to it." `blend.test.ts` pins this. IN PRACTICE, ON A REAL
 * SHIPPED BOARD, this exact-zero case is rare rather than typical: `constants.impliedGamesByPosition`
 * is a fitted decimal (a real population's own mean games played), and a real availability outlook's
 * `expected` is itself a continuous number a fitted decimal will only coincidentally equal exactly.
 * Nearly every real candidate therefore carries SOME nonzero availability delta — the identity is a
 * structural guarantee about what the blend admits, never a claim that most players land on it.
 *
 * WHY THE OUTPUT IS STILL A `BoardCandidate`, CARRYING A `StatLine` NOBODY ELSE READS THIS WAY. The
 * blend operates entirely in POINTS SPACE — a season total, never a stat-by-stat prediction — but
 * `preseason/board.ts`'s `preseasonBoard` (and everything downstream of it: `board-store.ts`'s
 * `projectionRows`, the outlook floor/median/ceiling) all multiply a `perGame` line by an expected
 * games count and score the result. Rather than inventing a second, parallel "season points" board
 * shape, this module writes the blended season total back onto a synthetic `perGame` line
 * (`pointsOnlyPerGame`, below) so the existing pipeline composes it unchanged. `board-store.ts`'s
 * own docblock already establishes that nothing downstream reads a candidate's individual stat
 * categories — only the composed point total and the outlook derived from it are ever stored or
 * shown — so discarding the model's real rushing/receiving/passing composition in favour of a
 * single carrier field costs the product nothing.
 */

/**
 * M3 (fix round): the ONE invariant `pointsOnlyPerGame`'s carrier field depends on — every scoring
 * preset this engine ships (`domain/scoring.ts`'s `STANDARD_SCORING`/`PPR_SCORING`/`HALF_PPR_SCORING`/
 * `TE_PREMIUM_SCORING`) weights `receivingYards` identically, 0.1 points/yard, with no
 * position-conditional bonus and no threshold logic. `pointsOnlyPerGame` hardcodes `PPR_SCORING`'s
 * own weight rather than accepting a `ScoringRules` parameter, because the market curve itself is
 * fit exclusively in `PPR_SCORING` (`market/curve.ts`'s own hardcoded import) — a blend anchored to
 * a PPR-fit curve has no honest way to re-price itself in a league's own rules anyway. This assert
 * fires at MODULE LOAD, not per call, so a future preset that dared to change this weight would fail
 * every test in the suite immediately rather than silently mis-encoding points for whichever preset
 * changed it.
 */
if (PPR_SCORING.pointsPerReceivingYard <= 0) {
  throw new Error(
    "market/blend.ts: pointsOnlyPerGame's carrier field assumes PPR_SCORING.pointsPerReceivingYard is a positive constant.",
  );
}

/**
 * The one field the synthetic per-game line carries its points in: `receivingYards`, weighted a
 * flat 0.1 points/yard in `PPR_SCORING` with NO position-conditional bonus (unlike `receptions`,
 * which carries the TE bonus) and no threshold or tier logic (unlike the DEF-only tables). Every
 * position this blend ever runs for — QB, RB, WR, TE — scores it identically, so one field can
 * carry an exact points value regardless of which position the candidate plays. See the module-load
 * assertion above (M3) for why this weight is safe to hardcode rather than thread through as a
 * parameter.
 */
function pointsOnlyPerGame(candidate: BoardCandidate, seasonPoints: number): StatLine {
  const games = candidate.games.expected;
  const perGamePoints = games > 0 ? seasonPoints / games : 0;
  return {
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) as Omit<StatLine, "playerId" | "week">),
    playerId: candidate.perGame.playerId,
    week: candidate.perGame.week,
    receivingYards: perGamePoints / PPR_SCORING.pointsPerReceivingYard,
  };
}

/** A candidate's own composed season points — the same arithmetic `preseasonBoard` runs, exposed
 *  here so `blendBoard`'s "unlisted" fallback and `scoreBlendConstants`'s grid search both read the
 *  identical number a real board would show, rather than a second definition of it. */
export function seasonPointsOf(candidate: BoardCandidate): number {
  return computeFantasyPoints(scaleStatLine(candidate.perGame, candidate.games.expected), candidate.position, PPR_SCORING);
}

/** How far a single confirmed law's own exposure-scaled delta, or the combined total across every
 *  admitted delta, is allowed to move a player off `marketPoints`. Fit by `scripts/blend-fit.ts`'s
 *  small grid search on TRAIN seasons only — see that script's own docblock for the grid and the
 *  rank-correlation scores it chose these from. */
export interface BlendConstants {
  /** Cap, in season points, on ONE confirmed law's own exposure-scaled delta. */
  readonly lawCapPoints: number;
  /** Cap, in season points, on the availability-gap delta (clause (b), below). */
  readonly availabilityCapPoints: number;
  /** Cap, in season points, on the COMBINED total of every admitted delta for one player — the
   *  outer bound, checked after every individual cap above has already been applied. */
  readonly totalCapPoints: number;
  /**
   * THE MARKET'S OWN IMPLIED GAMES-PLAYED ASSUMPTION, per position (I3+I5 fix round, 2026-08-31) —
   * `market/curve.ts`'s `fitImpliedGamesByPosition`, run on the market curve's own TRAIN population.
   * Clause (b) measures its gap against THIS, never `teamGamesIn(season)`: `marketPoints` is already
   * an empirical average over real player-seasons at that ADP rank, most of which missed real games
   * to injury — the curve already prices that attrition in. Comparing the model's `expectedGames`
   * against a naive full-season assumption double-counted that attrition for nearly every player on
   * the board. See `admittedDelta`'s own docblock for the full argument.
   */
  readonly impliedGamesByPosition: ImpliedGamesByPosition;
  /**
   * THE UNLISTED FALLBACK'S OWN RESCALE, per position (C2 fix round, 2026-08-31). A diagnostic run
   * over 2023/2024 (see `scripts/blend-fit.ts`'s own real run for the numbers, and the fix round's
   * report) found the raw model's own unlisted fallback landing implausibly high against the
   * market-anchored blend around it — an unlisted player at overall rank 20 in 2023, rank 43 in
   * 2024, both comfortably inside the DECISION RULE'S own "any unlisted player lands top-100"
   * trigger. `fitUnlistedRescale` fits `marketPoints ≈ slope × rawPoints + intercept` per position,
   * OLS, over every TRAIN-season LISTED player (where both numbers exist to compare) — applied to
   * an unlisted candidate's own raw season points before they ever reach the board, so an unlisted
   * player is priced on the SAME scale a listed one would be, not the raw model's own uncalibrated
   * one. See `admittedDelta`'s sibling, the unlisted branch inside `blendBoard`, for where this is
   * applied.
   */
  readonly unlistedRescale: UnlistedRescaleByPosition;
}

/** One position's own affine rescale: `marketPoints ≈ slope × rawPoints + intercept`, valid for a
 *  raw points value AT OR ABOVE `domainMin` — see `rescaledUnlistedPoints`'s own docblock for why a
 *  raw value below it is left unrescaled rather than extrapolated. */
export interface UnlistedRescaleCoefficients {
  readonly slope: number;
  readonly intercept: number;
  /** The smallest raw model season-points value any TRAIN listed player at this position actually
   *  had — the low edge of the population `fitUnlistedRescale` regressed over. */
  readonly domainMin: number;
}

export type UnlistedRescaleByPosition = Readonly<Record<CurvePosition, UnlistedRescaleCoefficients>>;

export interface BlendEvidenceOptions {
  /** The season being blended. Carried for provenance and for any future clause that needs it;
   *  clause (b) no longer reads it directly (I3+I5 fix round retired `teamGamesIn(season)` as its
   *  own denominator in favour of `constants.impliedGamesByPosition`). */
  readonly season: number;
  /** Defaults to the committed, grid-searched `FITTED_BLEND_CONSTANTS`. A caller (a test, or the
   *  fit script's own scoring loop) passes its own to drive the blend with different caps. */
  readonly constants?: BlendConstants;
  /**
   * THE CONFIRMED LAW REGISTRY (C1 fix round, 2026-08-31) — defaults to the real `registry()`, the
   * same default-from-a-committed-file pattern `preseason/source.ts`'s `loadPreseason` uses for its
   * own `laws` parameter. `admittedDelta` looks up each admitted `"law"` reason's OWN `trainEffect`
   * here, by `lawId` — never the reason's own `effect` field, which is the full-window measurement
   * `/player-laws` displays and which spans predictor seasons through 2023, overlapping the
   * final-bar seasons this blend's own fit is forbidden to see. A test drives this with a small
   * hand-built `Law[]` instead of the real ~1,700-law registry.
   */
  readonly laws?: readonly Law[];
}

/** A full season's worth of games — the fixed reference `FULL_SEASON_GAMES` normalizes a law's
 *  exposure-scaled delta against. Deliberately NOT `constants.impliedGamesByPosition`: the exposure
 *  fraction below is a fixed calibration of a law's own scale (see clause (a)'s docblock on
 *  `admittedDelta`), not a per-position games assumption, and mixing the two would make a law's own
 *  applied magnitude depend on which position happened to have the largest fitted attrition. */
const FULL_SEASON_GAMES = 17;

function clampAbs(value: number, cap: number): number {
  return Math.min(cap, Math.max(-cap, value));
}

function isLawReason(reason: BoardReason): reason is Extract<BoardReason, { code: "law" }> {
  return reason.code === "law";
}

function rookieReasonOf(candidate: BoardCandidate): Extract<BoardReason, { code: "rookie" }> | null {
  return candidate.reasons.find((reason): reason is Extract<BoardReason, { code: "rookie" }> => reason.code === "rookie") ?? null;
}

/** `constants.impliedGamesByPosition`, safely narrowed and looked up for one candidate's own
 *  `Position` — throws for a position the table carries no entry for (`K`/`DEF`), which the shipped
 *  pipeline never emits a candidate at (`preseasonCandidates`' own docblock: "the whole preseason
 *  board projects nothing else") but a hand-built test fixture could, and a silent `undefined` divide
 *  would be a worse failure than a clear one. */
function impliedGamesFor(position: Position, table: ImpliedGamesByPosition): number {
  if (!isCurvePosition(position)) {
    throw new Error(`market/blend.ts: no implied-games entry for position "${position}" — the blend only ever runs for QB/RB/WR/TE.`);
  }
  return table[position];
}

/** The identical narrow-and-lookup discipline `impliedGamesFor` uses, for `unlistedRescale`. */
function rescaleFor(position: Position, table: UnlistedRescaleByPosition): UnlistedRescaleCoefficients {
  if (!isCurvePosition(position)) {
    throw new Error(`market/blend.ts: no unlisted-rescale entry for position "${position}" — the blend only ever runs for QB/RB/WR/TE.`);
  }
  return table[position];
}

/**
 * AN UNLISTED CANDIDATE'S OWN RESCALED SEASON POINTS (C2 fix round) — his raw model season points,
 * run through `constants.unlistedRescale`'s own per-position affine fit, floored at zero (a points
 * baseline is non-negative by construction, the identical discipline `marketCurve`/`rookieCurve`
 * apply at their own accessors).
 *
 * NEVER EXTRAPOLATED BELOW `domainMin` — a real finding from this fix round's own diagnostic. The
 * fit's own intercept is large (the market's typical points for a BARELY-drafted player, since the
 * regression is fit ONLY over LISTED, drafted-quality rows); applying it uncorrected to a deep
 * camp body's near-zero raw points invents a market opinion for a player the fit never saw evidence
 * about, HANDING HIM A SPURIOUS FLOOR rather than leaving his own (already reasonable, near-zero)
 * raw number alone. A raw value at or above `domainMin` — inside the population the fit actually
 * regressed over — is rescaled; a raw value below it passes through UNCHANGED.
 */
function rescaledUnlistedPoints(candidate: BoardCandidate, constants: BlendConstants): number {
  const { slope, intercept, domainMin } = rescaleFor(candidate.position, constants.unlistedRescale);
  const raw = seasonPointsOf(candidate);
  if (raw < domainMin) return raw;
  return Math.max(0, slope * raw + intercept);
}

/**
 * ONE PLAYER'S ADMITTED DELTA off `marketPoints`, from every reason his model candidate already
 * carries and the confirmed law registry's own train-only evidence.
 *
 * CLAUSE (a), CONFIRMED LAWS: for each `"law"` reason already on the candidate — attached upstream,
 * unconditionally, by `preseason/source.ts`'s `loadPreseason`/`lawReasonsFor` for every CONFIRMED
 * law whose condition holds for him — the delta is scaled off that law's own `trainEffect`
 * (C1 fix round: `evidence.laws`'s matching `Law.trainEffect`, NEVER the reason's own `effect`
 * field, which is the full-window measurement spanning predictor seasons through 2023 — the exact
 * leak this fix round's finding named). `trainEffect` is scaled by this player's OWN exposure,
 * `expectedGames / FULL_SEASON_GAMES`, then capped at `lawCapPoints`. THE BRIEF'S OWN RULING: this
 * exposure fraction is a deliberate, documented simplification — "effect × EXPECTED_GAMES/17 is
 * acceptable" — chosen over a bare `effect × expectedGames` (which would be the dimensionally
 * literal per-game-to-season conversion) because it additionally DAMPENS every law's applied delta
 * by a factor of `FULL_SEASON_GAMES`, keeping a single confirmed law's nudge modest before the cap
 * even engages. That is intentional conservatism, not an approximation error: this board spends
 * disagreement sparingly, and a law's own bootstrap CI is real evidence but not certainty.
 *
 * CLAUSE (b), THE AVAILABILITY GAP (I3+I5 fix round, rewritten): the market's own number is an
 * empirical average over REAL player-seasons at that ADP rank, most of which missed some real games
 * — the curve already prices that attrition in. The gap this clause measures is therefore between
 * the model's own `expectedGames` and `constants.impliedGamesByPosition[position]` — the market
 * curve's OWN train population's mean games played at that position — NEVER a naive
 * `teamGamesIn(season)` full-season assumption, which nearly every real player falls short of and
 * would therefore systematically drag the blend below market for the ordinary case, not only the
 * genuinely injury-flagged one. The gap is converted to season points via the market's OWN implied
 * per-game rate (`marketPoints / impliedGames`) — the only rate available that is anchored to THIS
 * player's own market price rather than a positional average — then capped at `availabilityCapPoints`.
 * Positive when the model expects MORE games than the market's own population typically saw at that
 * position; negative when it expects fewer.
 *
 * CLAUSE (c), LISTED ROOKIES: handled directly inside `blendBoard`, before this function is ever
 * called — a full substitution of `marketPoints` by `rookieCurve` for a rookie the ADP board has
 * priced (M7 fix round: "listed" is load-bearing — an unlisted rookie never reaches this function
 * or that substitution at all, having already returned via the market-unlisted branch), so neither
 * clause above ever runs for him.
 *
 * NEITHER CLAUSE READS ANYTHING BEYOND `trainEffect` AND WHAT THE CANDIDATE ALREADY CARRIES.
 * `magnitude` (a law reason's own player-specific fact) is intentionally UNUSED here: `trainEffect`
 * is the one number a confirmed law's registry entry measures as the points/game delta ITS OWN
 * CONDITION PREDICTS on train seasons alone, and re-deriving a different scaling from `magnitude`
 * would be inventing a second, unmeasured effect size per player. `lawReasonsFor`
 * (`laws/board-reasons.ts`) already decided which laws fired; this function's only job is turning
 * "fired" into "how many points," off the train-only number.
 */
function admittedDelta(
  candidate: BoardCandidate,
  marketPoints: number,
  trainEffectByLawId: ReadonlyMap<string, number>,
  constants: BlendConstants,
): number {
  const exposure = candidate.games.expected / FULL_SEASON_GAMES;
  let lawTotal = 0;
  for (const reason of candidate.reasons.filter(isLawReason)) {
    const trainEffect = trainEffectByLawId.get(reason.lawId);
    if (trainEffect === undefined) {
      throw new Error(
        `market/blend.ts: "${reason.lawId}" fired a BoardReason but has no matching entry in evidence.laws — the model and the law registry have drifted.`,
      );
    }
    lawTotal += clampAbs(trainEffect * exposure, constants.lawCapPoints);
  }

  const impliedGames = impliedGamesFor(candidate.position, constants.impliedGamesByPosition);
  const availabilityGap = candidate.games.expected - impliedGames;
  const availabilityDelta = clampAbs((availabilityGap * marketPoints) / impliedGames, constants.availabilityCapPoints);

  return clampAbs(lawTotal + availabilityDelta, constants.totalCapPoints);
}

/**
 * THE BLENDED BOARD — every model candidate, priced off the market wherever the market has an
 * opinion and evidence has not overridden it, and off the raw model everywhere it does not.
 *
 * ITERATES THE MODEL'S OWN CANDIDATE SET, never the market's: the market board is an ADP snapshot
 * of a few hundred players, the model projects every man on a week-one roster, and a player the
 * model has no opinion on cannot be blended at all — there would be no `games`/`perGame` to carry
 * a market number on. A market row with no matching model candidate (rare — the ADP board and the
 * model's own player universe overlap almost completely, since both are drawn from a real week-one
 * roster) is silently absent from the output, exactly as it always was for the raw board: this
 * function is additive information on top of the model's own set, never a second, wider universe.
 *
 * AN UNLISTED CANDIDATE'S POINTS ARE RESCALED, NOT PASSED THROUGH RAW (C2 fix round, 2026-08-31): a
 * diagnostic run found the raw model's own unlisted fallback landing implausibly high without it —
 * see `BlendConstants.unlistedRescale`'s own docblock for the finding and the fix. His `reasons`
 * still carry `market_unlisted`, unchanged: rescaling is a POINTS correction, not a claim that a
 * market opinion exists for him.
 *
 * EVERY LISTED CANDIDATE CARRIES A NEW `"market_anchor"` REASON (I6 fix round, 2026-08-31): the
 * market entry he was blended against and the total admitted delta, so a reader of his reason list
 * can see not just WHAT moved him (the law/availability reasons already there) but WHERE he started
 * and BY HOW MUCH the blend actually moved him — the number `marketPoints + delta` composes into.
 * M8 RULING: `market_anchor` (and `market_unlisted`) are deliberately excluded from
 * `reason-chip.tsx`'s `strongestLawReasons` — the two-chip compact board surface stays LAW-ONLY, as
 * it always was; both new codes render only in a full reason list (PlayerPeek's own outlook), which
 * `strongestLawReasons`'s own `"law"`-only filter already guarantees without any change there — see
 * `reason-chip.test.tsx`'s own pin.
 */
export function blendBoard(market: readonly MarketPriorEntry[], model: readonly BoardCandidate[], evidence: BlendEvidenceOptions): readonly BoardCandidate[] {
  const constants = evidence.constants ?? FITTED_BLEND_CONSTANTS;
  const laws = evidence.laws ?? registry();
  const trainEffectByLawId = new Map(laws.map((law) => [law.id, law.trainEffect] as const));
  const marketByPlayer = new Map(market.map((entry) => [entry.playerId, entry] as const));

  return model.map((candidate) => {
    const marketEntry = marketByPlayer.get(candidate.playerId);
    if (marketEntry === undefined) {
      return {
        ...candidate,
        perGame: pointsOnlyPerGame(candidate, rescaledUnlistedPoints(candidate, constants)),
        reasons: [...candidate.reasons, { code: "market_unlisted" }],
      };
    }

    // CLAUSE (c) — a rookie WITH a recorded draft pick REPLACES marketPoints outright, ignoring the
    // market's own number entirely: the market prices rookie hype (name recognition, landing-spot
    // buzz, summer narrative), `rookieCurve` prices draft capital (what an NFL front office actually
    // paid for him), and Task 4's whole argument for that curve is that the two answer different
    // questions. A rookie the draft-pick table has no record of (`overallPick: null` — a UDFA the
    // model still emits a candidate for) has no curve value to substitute, so he falls through to
    // the ordinary market-plus-evidence path below like anyone else on the market board.
    const rookie = rookieReasonOf(candidate);
    if (rookie !== null && rookie.overallPick !== null) {
      const rookiePoints = rookieCurve(candidate.position, rookie.overallPick);
      return {
        ...candidate,
        perGame: pointsOnlyPerGame(candidate, rookiePoints),
        reasons: [
          ...candidate.reasons,
          { code: "market_anchor", marketPoints: marketEntry.marketPoints, delta: rookiePoints - marketEntry.marketPoints },
        ],
      };
    }

    const delta = admittedDelta(candidate, marketEntry.marketPoints, trainEffectByLawId, constants);
    const blendedPoints = Math.max(0, marketEntry.marketPoints + delta);
    return {
      ...candidate,
      perGame: pointsOnlyPerGame(candidate, blendedPoints),
      reasons: [...candidate.reasons, { code: "market_anchor", marketPoints: marketEntry.marketPoints, delta }],
    };
  });
}

/**
 * A LAW-ABLATED VARIANT of any `BlendConstants` (C1(ii) fix round, 2026-08-31) — `lawCapPoints`
 * forced to zero, every other cap and the implied-games table unchanged. Task 11's own scorecard
 * needs "the blend minus law evidence" as a third arm alongside the raw model and the full blend, to
 * isolate how much of the blend's own measured lift (if any) comes from law deltas specifically
 * versus the availability-gap term alone. Reachable as:
 *
 *   blendBoard(market, model, { season, constants: withLawsAblated(FITTED_BLEND_CONSTANTS) })
 *   shippedPreseasonCandidates(db, inputs, priors, { constants: withLawsAblated(FITTED_BLEND_CONSTANTS) })
 *
 * A capped-at-zero law delta is functionally identical to no confirmed law ever firing at all: every
 * `"law"` reason still contributes `clampAbs(trainEffect * exposure, 0)`, which is exactly zero
 * regardless of `trainEffect`'s own sign or size — so this is a genuine ablation of clause (a)'s
 * CONTRIBUTION to the total, not merely a documentation note about how to reach one.
 */
export function withLawsAblated(constants: BlendConstants): BlendConstants {
  return { ...constants, lawCapPoints: 0 };
}

/** The last predictor season `scoreBlendConstants` may be scored against. See its own docblock. */
export const BLEND_TRAIN_CUTOFF_SEASON = 2021;

/** One player-season the grid search scores a candidate `BlendConstants` set against: his market
 *  entry, his model candidate (carrying every reason already fired for him), and what he actually
 *  scored that season. Built by `scripts/blend-fit.ts` from the store; kept here as a plain data
 *  shape so this module's own tests can construct one without touching a database. */
export interface BlendTrainRow {
  readonly season: number;
  readonly market: MarketPriorEntry;
  readonly candidate: BoardCandidate;
  readonly actualPoints: number;
}

export interface BlendScoreOptions {
  /** EXTRA seasons to refuse beyond the structural `BLEND_TRAIN_CUTOFF_SEASON` gate every call gets
   *  for free — the identical `heldOutSeasons` discipline `fitMarketCurve`/`fitRookieCurve` use. */
  readonly heldOutSeasons: readonly number[];
  /** The confirmed law registry the grid search blends every row against — see
   *  `BlendEvidenceOptions.laws`'s own docblock. Defaults to the real `registry()`. */
  readonly laws?: readonly Law[];
}

/**
 * SCORES ONE CANDIDATE `BlendConstants` SET — the grid search's own inner loop, pure and exported
 * so `scripts/blend-fit.ts` and this module's tests share the identical scoring rule rather than
 * two copies of it drifting apart.
 *
 * Blends every row with the candidate constants, then rank-correlates (`metrics.ts`'s `spearman`,
 * the SAME primary metric every other scorecard in this engine uses) the blended season points
 * against what each player actually scored. `null` when `spearman` itself would be — see that
 * function's own docblock — passed straight through rather than coerced into a fake zero, so a grid
 * cell with no real signal in it stays visibly unscoreable to `scripts/blend-fit.ts` rather than
 * looking like the worst-possible real score.
 *
 * THE GATE IS UNCONDITIONAL, exactly like `fitMarketCurve`/`fitRookieCurve`'s own —
 * `BLEND_TRAIN_CUTOFF_SEASON` is checked directly against every row's own season, never trusted to
 * whatever seasons `scripts/blend-fit.ts` happened to load. A grid search scored on a season it will
 * later be judged on is not a measurement.
 *
 * C1(iii) — WHAT STILL ISN'T FULLY TRAIN-CLEAN, NAMED RATHER THAN HIDDEN: this function's own gate
 * keeps every ROW's season at or before `BLEND_TRAIN_CUTOFF_SEASON`, and `admittedDelta` reads a
 * law's `trainEffect` rather than its full-window `effect` (C1(i)), so no OUTCOME from 2023/2024
 * ever reaches a score this function returns. What is NOT bounded here is LAW SELECTION: whether a
 * `"law"` reason exists on a candidate AT ALL depends on `registry()`'s own `verdict`, and
 * `verdictForFullWindow`/`verdictForDiscoveredLaw` require agreement across `REPLICATION_FOLDS`
 * (2021, 2022, 2023) — so 2023's own year-over-year outcomes help decide WHICH laws are confirmed
 * (and therefore ever admitted here) even though they never set HOW MUCH a confirmed law moves a
 * player. The bound: this is a selection effect over a small, discrete set (six tribal laws plus a
 * handful of discovered survivors), not a continuous leak into any one score, and it is the SAME
 * selection every other consumer of `registry()`'s confirmed laws already lives with (the raw
 * board's own law reasons, `/player-laws`) — `scripts/blend-fit.ts` inherits it rather than
 * introducing it.
 */
export function scoreBlendConstants(rows: readonly BlendTrainRow[], constants: BlendConstants, { heldOutSeasons, laws }: BlendScoreOptions): number | null {
  const forbidden = new Set(heldOutSeasons);
  for (const row of rows) {
    if (row.season > BLEND_TRAIN_CUTOFF_SEASON) {
      throw new Error(
        `A blend grid search was handed a row for ${row.season}, which is past BLEND_TRAIN_CUTOFF_SEASON ` +
          `(${BLEND_TRAIN_CUTOFF_SEASON}) and therefore held out by construction. A grid search scored on a ` +
          `season it is later judged on is not a measurement.`,
      );
    }
    if (forbidden.has(row.season)) {
      throw new Error(
        `A blend grid search was handed a row for ${row.season}, which is held out. A grid search scored on a season it is later judged on is not a measurement.`,
      );
    }
  }

  const observations: Observation[] = rows.map((row) => {
    const [blended] = blendBoard([row.market], [row.candidate], { season: row.season, constants, laws });
    return { predicted: seasonPointsOf(blended!), actual: row.actualPoints };
  });
  return spearman(observations);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * FITS `BlendConstants.unlistedRescale` — ORDINARY LEAST SQUARES, per position, over every TRAIN
 * row's own (raw model points, market points) pair (C2 fix round, 2026-08-31). Reuses
 * `scripts/blend-fit.ts`'s own `BlendTrainRow`s rather than a second population: a `BlendTrainRow`
 * only exists for a player who is on BOTH boards (`rowsForSeason`'s own join), so this is exactly
 * the "listed player, both numbers known" population the fit needs, with zero new DB reads.
 *
 * `slope = covariance(raw, market) / variance(raw)`, `intercept = mean(market) - slope * mean(raw)`
 * — the closed-form single-variable OLS solution. A position with fewer than two rows, or with
 * every row's raw points identical (zero variance — nothing to regress on), falls back to the
 * IDENTITY transform (`slope: 1, intercept: 0`, i.e. no rescale at all) rather than dividing by
 * zero or fitting a line through one point: an under-populated position gets the raw model's own
 * number unchanged, which is exactly what shipped before this fix round and is a safe default, not
 * a silent guess.
 *
 * THE GATE IS UNCONDITIONAL, matching `scoreBlendConstants`'s own: every row's season is checked
 * against `BLEND_TRAIN_CUTOFF_SEASON` directly, never trusted to whichever rows a caller happened
 * to load.
 */
export function fitUnlistedRescale(rows: readonly BlendTrainRow[]): UnlistedRescaleByPosition {
  for (const row of rows) {
    if (row.season > BLEND_TRAIN_CUTOFF_SEASON) {
      throw new Error(
        `fitUnlistedRescale was handed a row for ${row.season}, which is past BLEND_TRAIN_CUTOFF_SEASON ` +
          `(${BLEND_TRAIN_CUTOFF_SEASON}) and therefore held out by construction. A rescale fitted on a season ` +
          `it is later scored on is not a measurement.`,
      );
    }
  }

  const result = {} as Record<CurvePosition, UnlistedRescaleCoefficients>;
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    const atPosition = rows.filter((row) => row.candidate.position === position);
    if (atPosition.length < 2) {
      result[position] = { slope: 1, intercept: 0, domainMin: 0 };
      continue;
    }
    const xs = atPosition.map((row) => seasonPointsOf(row.candidate));
    const ys = atPosition.map((row) => row.market.marketPoints);
    const domainMin = Math.min(...xs);
    const meanX = mean(xs);
    const meanY = mean(ys);
    let covariance = 0;
    let varianceX = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const dx = xs[i]! - meanX;
      covariance += dx * (ys[i]! - meanY);
      varianceX += dx * dx;
    }
    if (varianceX === 0) {
      result[position] = { slope: 1, intercept: 0, domainMin: 0 };
      continue;
    }
    const slope = covariance / varianceX;
    result[position] = { slope, intercept: meanY - slope * meanX, domainMin };
  }
  return result;
}

export interface ShippedCandidatesOptions {
  /**
   * Skips the market blend and returns the raw model board, unchanged — the flag this module's own
   * docblock and the task brief promise: Task 11's scorecard comparison passes `{ raw: true }` to
   * read the pre-blend board explicitly. Every other caller (in particular
   * `scripts/preseason-persist.ts`, the shipped board) leaves this `false` and gets the blend.
   */
  readonly raw?: boolean;
  /** Defaults to `SHIPPED_PRESEASON_FEATURES` — the feature set the shipped board itself runs with.
   *  A caller doing its own ablation may pass a different set, exactly like `preseasonCandidates`
   *  itself accepts one. */
  readonly features?: PreseasonFeatures;
  /** Defaults to the committed `FITTED_BLEND_CONSTANTS`; a caller may override for testing, or pass
   *  `withLawsAblated(FITTED_BLEND_CONSTANTS)` for the law-ablated arm (C1(ii)). */
  readonly constants?: BlendConstants;
  /** Defaults to the real `registry()`; see `BlendEvidenceOptions.laws`'s own docblock. */
  readonly laws?: readonly Law[];
}

/**
 * THE SHIPPED CANDIDATE PIPELINE — market-blended by default, and the one function
 * `scripts/preseason-persist.ts` calls to build the board it writes down.
 *
 * `raw: true` is the ONLY way to get the pre-blend candidates back out of this function, and it is
 * spelled out explicitly at every call site rather than defaulted to, so a reader of
 * `preseason-report.ts` or a future Task 11 scorecard script can see at the call site which board
 * they are looking at. See the module docblock for why the market blend, not the raw model, is what
 * ships.
 *
 * M2 (fix round): `marketBoard`'s own `droppedCount` is READ AND SURFACED here — the site that
 * actually consumes a season's market board for the shipped product, rather than left to whichever
 * script happens to call this function to remember to check it. A nonzero count is not an error (a
 * dropped ADP row is an ordinary, already-documented `marketBoard` outcome — see that function's own
 * docblock), so this warns rather than throws, the same `console.warn`-on-drop discipline
 * `board-store.ts`'s own `boardReasons` reader already uses for an unrecognised reason code.
 */
export async function shippedPreseasonCandidates(
  db: ReadonlyDb,
  inputs: PreseasonInputs,
  priors: PreseasonPriors,
  { raw = false, features = SHIPPED_PRESEASON_FEATURES, constants, laws }: ShippedCandidatesOptions = {},
): Promise<readonly BoardCandidate[]> {
  const candidates = preseasonCandidates(inputs, features, priors);
  if (raw) return candidates;
  const { entries: market, droppedCount } = await marketBoard(db, inputs.season);
  if (droppedCount > 0) {
    console.warn(`market/blend.ts: marketBoard for ${inputs.season} dropped ${droppedCount} ADP row(s) with an unresolved position.`);
  }
  return blendBoard(market, candidates, { season: inputs.season, constants, laws });
}
