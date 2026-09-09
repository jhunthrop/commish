import type { ReadonlyDb } from "@/db/client";
import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints, type ScoringRules } from "@/scoring/compute";
import { clusterKeyFor } from "../laws/clusters";
import { pricingEligibleLawIds } from "../laws/pricing";
import { registry } from "../laws/registry";
import type { Law } from "../laws/types";
import { spearman, type Observation } from "../metrics";
import { scaleStatLine, type BoardCandidate, type BoardReason } from "../preseason/board";
import { DEFAULT_BOARD_FORMAT, type BoardFormat } from "../preseason/board-formats";
import { withAvailabilityRecency } from "../preseason/availability";
import { kdefCandidates } from "../preseason/kdef-candidates";
import { KDEF_POSITIONS, shipsProjectedRows } from "../preseason/kdef-decision";
import { FITTED_DEFENSE_PRIORS, FITTED_KICKER_PRIORS } from "../preseason/kdef-fitted";
import { kdefHistorySeasonsFor, loadKdefHistory } from "../preseason/kdef-history";
import { preseasonRostersAsOf } from "../preseason/store";
import { historicalRookieExpectedGames, rookieCurve, rookieCurveEvidenceN } from "../preseason/rookie-curve";
import { gateCandidates, type ExcludedCandidate } from "../preseason/roster-status-gate";
import { rosterStatusesAsOf, type SweepCoverage } from "../preseason/roster-status-read";
import { shrinkTowardMarket } from "./thin-evidence-shrink";
import {
  preseasonCandidates,
  SHIPPED_PRESEASON_FEATURES,
  type PreseasonFeatures,
  type PreseasonInputs,
  type PreseasonPriors,
} from "../preseason/source";
import { FITTED_BLEND_CONSTANTS } from "./blend-fitted";
import { blendConstantsFor, formatAnchorFor } from "./format-anchor";
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
 *
 * AN UNLISTED CANDIDATE'S PRICING (C2 fix round 1; SIMPLIFIED fix round 3, IMPORTANT 1). His raw
 * model season points, capped at `constants.marketTailByPosition[position]` — `Math.min(rawPoints,
 * tail)`, nothing else. Fix round 1 and fix round 2 shipped a two-layer version of this (an affine
 * rescale onto the market's own scale, THEN the tail cap), but fix round 3's own audit found the
 * rescale layer dead on arrival: every fitted intercept (RB 89.85, WR 99.13, TE 101.40) already sat
 * above that position's own tail (RB 45.96, WR 85.79, TE 85.56), so the affine map's output was
 * discarded by the very next `Math.min` for every candidate at every raw points value the fit's own
 * domain covered — the rescale never once changed a shipped number, it only ever cost a layer of
 * indirection and, worse, COLLAPSED EVERY UNLISTED CANDIDATE AT A POSITION TO THE IDENTICAL TAIL
 * VALUE, erasing whatever ordering the raw model itself carried among them. `Math.min(rawPoints,
 * tail)` alone preserves that ordering (a raw-100 player still outranks a raw-50 player, both still
 * capped below the tail if either exceeds it) while keeping the identical structural guarantee: no
 * unlisted player's final number can exceed the market's own cheapest drafted man at his position.
 * `scripts/blend-diagnostic.ts` is the committed, runnable check for the guarantee — the metrics
 * that actually catch a regression here are the position mix of the board's own top 100 and the
 * count of unlisted players still priced above their own positional tail, never a single "best
 * unlisted rank" number, which fix round 1's own diagnostic proved can look fine while an entire
 * position quietly breaks underneath it.
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
 *  identical number a real board would show, rather than a second definition of it. `rules` (the
 *  scoring-formats round) defaults to PPR, the preset every fit in this module was measured in. */
export function seasonPointsOf(candidate: BoardCandidate, rules: ScoringRules = PPR_SCORING): number {
  return computeFantasyPoints(scaleStatLine(candidate.perGame, candidate.games.expected), candidate.position, rules);
}

/**
 * HOW A CANDIDATE'S OWN STAT MIX RESCALES A PPR SEASON TOTAL INTO ANOTHER FORMAT (the
 * scoring-formats round): his raw line's points under `rules` over the same line's points under
 * PPR. EXACTLY ONE for PPR itself (`x / x`), so the default board is unchanged bit for bit, and one
 * for a line that scores nothing under PPR (a zero line has no mix to speak of). The rookie curve
 * (`rookieCurve`, fit in PPR points) is the one prior the blend substitutes for the market that
 * carries no stat line of its own, and this is how it enters a half-PPR or standard board: the
 * curve's season total, scaled by the share of this rookie's own projected points that survives the
 * format change. A receiving back keeps less of his PPR total than a rushing one, which is the
 * honest shape of the difference between the two formats.
 */
function formatRatioOf(candidate: BoardCandidate, rules: ScoringRules): number {
  const pprPoints = seasonPointsOf(candidate, PPR_SCORING);
  if (pprPoints <= 0) return 1;
  return seasonPointsOf(candidate, rules) / pprPoints;
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
   * THE STRUCTURAL TAIL GUARD, per position (fix round 2, ruling 2; the UNLISTED FALLBACK'S ONLY
   * PRICING RULE as of fix round 3, IMPORTANT 1 — an earlier affine rescale layer was removed here,
   * see `tailCappedUnlistedPoints`'s own docblock for why). The market curve's own value at the
   * DEEPEST listed ADP rank the TRAIN population reached at that position — equivalently (by the
   * curve's own monotone-non-increasing construction) the smallest `marketPoints` any TRAIN listed
   * player at that position carried. `fitMarketTailByPosition` computes it straight off the SAME
   * `BlendTrainRow`s the blend fit reads.
   *
   * `tailCappedUnlistedPoints` caps every unlisted candidate's own raw model points at this value:
   * AN UNLISTED PLAYER NEVER OUTRANKS THE CHEAPEST PLAYER THE MARKET ACTUALLY DRAFTED AT HIS
   * POSITION. This is deliberately aggressive — the real fitted RB tail sits around 51 points, well
   * below a useful bench piece's own raw model number — and it is accepted as such: a real unlisted
   * player is overwhelmingly a late-offseason signing or a genuine camp body, and `market_unlisted`'s
   * own reason chip is exactly the surface that explains why he is priced this conservatively rather
   * than the number silently looking wrong with no explanation attached.
   */
  readonly marketTailByPosition: MarketTailByPosition;
  /**
   * THE LAW-CHANNEL DEDUP AXIS (fit-round Task 3, deliverable B(ii)) — when true, a player takes the
   * SINGLE STRONGEST applicable law's delta within each correlation cluster (`laws/clusters.ts`)
   * rather than the sum of every law in that cluster. ABSENT IS THE NULL CELL and is today's
   * behaviour exactly: every fired law's own capped delta is summed.
   *
   * WHY IT IS AN AXIS RATHER THAN A DECISION TAKEN HERE. Task 2's redundancy finding (forty of ninety
   * confirmations touch one goal-line cluster, thirty-three touch one age/experience cluster) says
   * summing them admits one fact many times; it does NOT say the deduped board scores better. The fit
   * answers that, and it can only answer it if both behaviours are reachable cells of one grid.
   */
  readonly lawClusterDedup?: boolean;
  /**
   * THE PER-PLAYER LAW-CHANNEL CAP (fit-round Task 3, deliverable B(iii)) — a cap, in season points,
   * on the COMBINED law delta for one player, applied after every per-law cap and after any cluster
   * dedup, and before the availability delta joins it. ABSENT IS THE NULL CELL: the law channel is
   * bounded only by `lawCapPoints` per law and by `totalCapPoints` across every channel together.
   *
   * DISTINCT FROM `totalCapPoints`, which bounds law PLUS availability. This one bounds what the LAW
   * CHANNEL alone may ever spend on one player, which is the control the correlated clusters actually
   * need: forty correlated goal-line laws under a five-point per-law cap can move a player two hundred
   * points today, and no per-law cap value can stop that without also crushing a lone independent law.
   */
  readonly playerLawCapPoints?: number;
  /**
   * THE PROPS-ANCHOR WEIGHT (fit-round Task 3, deliverable C) — how far a listed player's anchor moves
   * off the ADP-derived `marketPoints` toward his archived pre-kickoff props anchor
   * (`market/props-anchor.ts`), in [0, 1]. ABSENT, OR ZERO, IS THE NULL CELL: ADP only, and
   * `anchorPointsFor` returns `marketPoints` unchanged, bit for bit, without doing any arithmetic to
   * it at all.
   *
   * A player with no props anchor for the season being blended (no archived pre-kickoff line for him,
   * or a season the archive does not cover at all) falls back to `marketPoints` at ANY weight — the
   * fallback is per player, so a partially covered season prices from props exactly where props exist
   * and from ADP everywhere else.
   */
  readonly propsAnchorWeight?: number;
  /**
   * THE AVAILABILITY RECENCY DECAY (fit-round Task 3, deliverable D) — the ONE MODEL-SIDE parameter
   * this fit moves, and the reason it lives on the BLEND's constants rather than on the availability
   * priors: `scripts/blend-fit.ts` is what fits it, against the blend's own objective, and a fitted
   * number belongs in the file its own fit generates.
   *
   * `shippedPreseasonCandidates` applies it through `withAvailabilityRecency` before building
   * candidates. ABSENT IS THE NULL CELL: the committed `FITTED_AVAILABILITY_PRIORS` object is used by
   * reference, unchanged, which is what makes today's expected games reproduce bit for bit.
   *
   * THE RAW ARM DELIBERATELY DOES NOT GET IT. `shippedPreseasonCandidates({ raw: true })` — Task 11's
   * pre-blend comparison arm — keeps the committed availability priors exactly. Letting the blend's
   * own fit move the baseline it is later compared against would flatter the comparison, and the
   * whole point of the raw arm is that it is the incumbent model.
   */
  readonly availabilityRecencyDecay?: number;
}

/** The structural tail guard's own committed table — see `BlendConstants.marketTailByPosition`'s
 *  own docblock for what each value means and why it caps the unlisted fallback. */
export type MarketTailByPosition = Readonly<Record<CurvePosition, number>>;

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
  /**
   * THE SEASON'S PROPS ANCHOR (fit-round Task 3, deliverable C) — player id to that player's archived
   * pre-kickoff props anchor, ALREADY IN THE MARKET CURVE'S OWN UNITS (`market/props-anchor.ts`'s
   * `propsAnchorPoints` does the conversion and the rescale, and owns the leakage gate). Defaults to
   * empty, which is the null cell for every season: an empty map means every player anchors on ADP
   * alone, whatever `constants.propsAnchorWeight` says.
   *
   * Deliberately a plain map rather than a database handle: the anchor is loaded ONCE per season by
   * whoever is driving the blend (`scripts/blend-fit.ts` for a fit, the persist script for a live
   * board), never re-read per candidate, and this module stays free of the odds store entirely.
   */
  readonly propsAnchor?: ReadonlyMap<string, number>;
  /**
   * THE FORMAT THE BOARD IS PRICED UNDER (the scoring-formats round, 2026-09-08). Defaults to
   * `PPR_SCORING`. The raw arm's own season points (`seasonPointsOf`, the unlisted fallback) and the
   * rookie prior's rescale (`formatRatioOf`) read it; the `market` entries handed in are expected to
   * already be the same format's own feed priced through the same format's own curve
   * (`format-anchor.ts`), and `constants.marketTailByPosition` that format's own tail.
   */
  readonly rules?: ScoringRules;
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

/** The identical narrow-and-lookup discipline `impliedGamesFor` uses, for `marketTailByPosition`. */
function marketTailFor(position: Position, table: MarketTailByPosition): number {
  if (!isCurvePosition(position)) {
    throw new Error(`market/blend.ts: no market-tail entry for position "${position}" — the blend only ever runs for QB/RB/WR/TE.`);
  }
  return table[position];
}

/**
 * AN UNLISTED CANDIDATE'S OWN TAIL-CAPPED SEASON POINTS (C2 fix round 1; SIMPLIFIED fix round 3,
 * IMPORTANT 1) — his raw model season points, capped at `constants.marketTailByPosition`: never
 * above the cheapest player the market itself drafted at his position.
 *
 * `Math.min(raw, tail)`, nothing else. An earlier version of this function ran `raw` through a
 * per-position affine rescale FIRST (`constants.unlistedRescale`, fit by `fitUnlistedRescale`) and
 * capped the RESULT at the tail — but every fitted intercept sat above that position's own tail
 * (RB 89.85 vs. a 45.96 tail, WR 99.13 vs. 85.79, TE 101.40 vs. 85.56), so the rescale's own output
 * was above the tail for every raw value the fit's domain covered, and `Math.min` always threw it
 * away in favour of the tail. That made the rescale layer dead code that ALSO broke something the
 * raw pass-through never did: every unlisted candidate at a position collapsed to the SAME tail
 * value, erasing whatever ordering the raw model carried among them (a legitimate depth piece and a
 * near-zero camp body priced identically). Capping the raw number directly keeps a real player's own
 * ordering among his unlisted peers while still guaranteeing no unlisted player ever outranks the
 * market's own cheapest drafted man at his position — the one property the tail cap exists for.
 */
function tailCappedUnlistedPoints(candidate: BoardCandidate, context: BlendContext): number {
  const raw = seasonPointsOf(candidate, context.rules);
  const tail = marketTailFor(candidate.position, context.constants.marketTailByPosition);
  return Math.min(raw, tail);
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
 *
 * CLAUSE (a) GAINED THREE CONTROLS IN THE FIT ROUND (Task 3, deliverables A and B). Each one's OFF
 * position is the incumbent behaviour exactly, so a grid cell with all of them off reproduces the
 * board this function shipped before them:
 *
 *   1. THE PRICING GATE (`laws/pricing.ts`): a CONFIRMED-BUT-SUSPECT law contributes nothing. Policy
 *      over admission, never a re-measurement — the law keeps its verdict, its board reason and its
 *      chip. This one has no off position: a law nobody could separate from an artifact is not
 *      evidence a price may be spent on, and the nine ids are carried with their reasons.
 *   2. CLUSTER DEDUP (`constants.lawClusterDedup`, `laws/clusters.ts`): the strongest single delta per
 *      correlation cluster instead of the sum over it, so forty correlated goal-line laws speak once.
 *   3. THE PER-PLAYER LAW-CHANNEL CAP (`constants.playerLawCapPoints`): a bound on what the law
 *      channel as a whole may spend on one player, distinct from the per-law cap under it and from
 *      `totalCapPoints` over it.
 *
 * `anchorPoints`, NOT `marketPoints`, IS WHAT CLAUSE (b) CONVERTS AGAINST (deliverable C). With the
 * props channel off — the null cell, and every season the archive does not cover — the two are the
 * identical number and this is a rename. With it on, the availability gap is priced off the anchor
 * this player is actually blended from, which is still the only rate anchored to his own price.
 */
function admittedDelta(candidate: BoardCandidate, anchorPoints: number, context: BlendContext): number {
  const { constants } = context;
  const exposure = candidate.games.expected / FULL_SEASON_GAMES;
  const dedup = constants.lawClusterDedup === true;
  /** Cluster key to the strongest signed delta seen in it so far — only used when deduping. */
  const strongestByCluster = new Map<string, number>();
  let lawTotal = 0;
  for (const reason of candidate.reasons.filter(isLawReason)) {
    const trainEffect = context.trainEffectByLawId.get(reason.lawId);
    if (trainEffect === undefined) {
      throw new Error(
        `market/blend.ts: "${reason.lawId}" fired a BoardReason but has no matching entry in evidence.laws — the model and the law registry have drifted.`,
      );
    }
    // THE PRICING-ADMISSION GATE (deliverable A). A law the registry CONFIRMS but Task 2's vigilance
    // record marks SUSPECT still fires its reason, still shows on `/player-laws` and still may be
    // cited by a chip — it simply never moves a price. The drift check above deliberately runs FIRST
    // and against every law, suspect or not, so gating a law can never be mistaken for the registry
    // and the model having drifted apart.
    if (!context.pricingEligibleIds.has(reason.lawId)) continue;
    const delta = clampAbs(trainEffect * exposure, constants.lawCapPoints);
    if (!dedup) {
      lawTotal += delta;
      continue;
    }
    // STRONGEST = LARGEST ABSOLUTE DELTA, sign kept. A strict `>` means a tie keeps the FIRST law in
    // the candidate's own reason order, which is `lawReasonsFor`'s registry order — deterministic.
    const key = context.clusterKeyByLawId.get(reason.lawId) ?? clusterKeyFor(reason.lawId);
    const held = strongestByCluster.get(key);
    if (held === undefined || Math.abs(delta) > Math.abs(held)) strongestByCluster.set(key, delta);
  }
  if (dedup) {
    for (const delta of strongestByCluster.values()) lawTotal += delta;
  }
  if (constants.playerLawCapPoints !== undefined) lawTotal = clampAbs(lawTotal, constants.playerLawCapPoints);

  const impliedGames = impliedGamesFor(candidate.position, constants.impliedGamesByPosition);
  const availabilityGap = candidate.games.expected - impliedGames;
  const availabilityDelta = clampAbs((availabilityGap * anchorPoints) / impliedGames, constants.availabilityCapPoints);

  return clampAbs(lawTotal + availabilityDelta, constants.totalCapPoints);
}

/**
 * EVERYTHING ONE BLEND NEEDS THAT DOES NOT VARY PER CANDIDATE — built once per (laws, constants,
 * props anchor) triple and reused across every row.
 *
 * WHY THIS EXISTS AS ITS OWN SHAPE (fit-round Task 3). `blendBoard` used to rebuild its
 * `trainEffectByLawId` map on every call, which is free for a board (one call, one map) and ruinous
 * for a fit: `scoreBlendConstants` calls the blend once PER ROW, and the fit-round grid multiplies
 * the cell count by the law-channel, props-anchor and recency axes. Rebuilding a ~180-entry map (plus
 * a pricing-eligibility set and a cluster lookup) per row per cell is tens of billions of map inserts
 * for a grid that ought to be seconds of arithmetic. The context is built once and threaded through.
 */
interface BlendContext {
  readonly constants: BlendConstants;
  /** EVERY law's train effect, suspect or not — the drift check reads this, so gating never looks
   *  like drift. */
  readonly trainEffectByLawId: ReadonlyMap<string, number>;
  /** The ids a delta may actually be spent on — `laws/pricing.ts`'s gate. */
  readonly pricingEligibleIds: ReadonlySet<string>;
  /** `laws/clusters.ts`'s key per law, precomputed for the laws this blend was handed. */
  readonly clusterKeyByLawId: ReadonlyMap<string, string>;
  /** Player id to props anchor points, in market units. Empty is the null cell. */
  readonly propsAnchor: ReadonlyMap<string, number>;
  /** The preset this blend prices under; see `BlendEvidenceOptions.rules`. */
  readonly rules: ScoringRules;
}

const EMPTY_PROPS_ANCHOR: ReadonlyMap<string, number> = new Map();

/** Builds the per-blend context. Validates `propsAnchorWeight` here, once, rather than per candidate:
 *  a weight outside [0, 1] is a fit-input bug and extrapolating past either anchor is not a blend. */
function blendContextOf(laws: readonly Law[], constants: BlendConstants, propsAnchor: ReadonlyMap<string, number>, rules: ScoringRules = PPR_SCORING): BlendContext {
  const weight = constants.propsAnchorWeight;
  if (weight !== undefined && (!Number.isFinite(weight) || weight < 0 || weight > 1)) {
    throw new Error(`market/blend.ts: propsAnchorWeight must lie in [0, 1]; got ${weight}. A weight outside the two anchors is not a blend.`);
  }
  const playerLawCap = constants.playerLawCapPoints;
  if (playerLawCap !== undefined && (!Number.isFinite(playerLawCap) || playerLawCap < 0)) {
    throw new Error(
      `market/blend.ts: playerLawCapPoints must be a finite, non-negative number of points; got ${playerLawCap}. A negative cap would invert every law delta it bounded rather than bounding it.`,
    );
  }
  return {
    constants,
    trainEffectByLawId: new Map(laws.map((law) => [law.id, law.trainEffect] as const)),
    pricingEligibleIds: pricingEligibleLawIds(laws),
    clusterKeyByLawId: new Map(laws.map((law) => [law.id, clusterKeyFor(law.id)] as const)),
    propsAnchor,
    rules,
  };
}

/**
 * ONE PLAYER'S ANCHOR — the point the blend starts from before any delta is admitted.
 *
 * `marketPoints` EXACTLY, bit for bit, whenever the props channel is switched off (the null cell) or
 * the archive holds no pre-kickoff line for this player. The explicit early return matters: writing
 * the general formula with a zero weight would return `marketPoints * 1 + props * 0`, which is the
 * same number in exact arithmetic and not guaranteed to be the same double.
 */
function anchorPointsFor(playerId: string, marketPoints: number, context: BlendContext): number {
  const weight = context.constants.propsAnchorWeight ?? 0;
  if (weight === 0) return marketPoints;
  const props = context.propsAnchor.get(playerId);
  if (props === undefined) return marketPoints;
  return marketPoints * (1 - weight) + props * weight;
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
 * AN UNLISTED CANDIDATE'S POINTS ARE TAIL-CAPPED, NOT PASSED THROUGH RAW UNCONDITIONALLY (C2 fix
 * round 1; SIMPLIFIED fix round 3, IMPORTANT 1): a diagnostic run found the raw model's own unlisted
 * fallback landing implausibly high without a cap — see `BlendConstants.marketTailByPosition`'s own
 * docblock for the finding and `tailCappedUnlistedPoints` for where the cap applies. His `reasons`
 * still carry `market_unlisted`, unchanged: capping is a POINTS correction, not a claim that a
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
  const context = blendContextOf(
    evidence.laws ?? registry(),
    evidence.constants ?? FITTED_BLEND_CONSTANTS,
    evidence.propsAnchor ?? EMPTY_PROPS_ANCHOR,
    evidence.rules ?? PPR_SCORING,
  );
  const marketByPlayer = new Map(market.map((entry) => [entry.playerId, entry] as const));
  return model.map((candidate) => blendCandidate(candidate, marketByPlayer.get(candidate.playerId), context, evidence.season));
}

/**
 * ONE CANDIDATE'S HONESTLY-RECOMPOSED ROOKIE SEASON TOTAL (calibration fix round, 2026-09-04,
 * Task 2) — REPLACES the earlier `rookieCurve(pick)` passed straight into `pointsOnlyPerGame`,
 * which divided a SEASON number by `candidate.games.expected` (THIS player's own, individually
 * fitted availability) to fake a per-game rate: two numbers from two different populations,
 * multiplied back together as though they described the same one.
 *
 * THE HONEST ALGEBRA: `rookieCurve(pick)` is a season total already averaged over the SAME
 * 2003-2021 population, WITHIN THE SAME DRAFT-CAPITAL BUCKET (fix round 1 — see
 * `historicalRookieExpectedGames`'s own docblock for why the denominator has to be bucket-matched
 * rather than pooled across every round), that `historicalRookieExpectedGames` measures its own
 * games-played rate against. Dividing by THAT bucket's own expected games — not this player's —
 * recovers the per-game rate that bucket's curve actually implies; multiplying back out by
 * `candidate.games.expected` (Task 1's OWN, separately-fitted availability distribution for THIS
 * player) then composes two honestly-sourced numbers instead of dividing a population total by an
 * unrelated individual estimate.
 */
function recomposeRookieSeasonPoints(candidate: BoardCandidate, overallPick: number, season: number): number {
  const historicalGames = historicalRookieExpectedGames(candidate.position, overallPick, season);
  const perGameRate = historicalGames > 0 ? rookieCurve(candidate.position, overallPick) / historicalGames : 0;
  return perGameRate * candidate.games.expected;
}

/**
 * ONE CANDIDATE, BLENDED — every branch `blendBoard`'s own docblock describes, for a single player.
 * Split out of `blendBoard` (fit-round Task 3) so the fit's scoring loop can blend row by row against
 * ONE prebuilt context instead of rebuilding the law map per row; `blendBoard` itself is now that map
 * plus this function. `season` (calibration fix round, Task 2) is threaded separately from `context`
 * because `scoreBlendConstants` reuses ONE context across rows spanning several different seasons.
 */
function blendCandidate(candidate: BoardCandidate, marketEntry: MarketPriorEntry | undefined, context: BlendContext, season: number): BoardCandidate {
  if (marketEntry === undefined) {
    return {
      ...candidate,
      perGame: pointsOnlyPerGame(candidate, tailCappedUnlistedPoints(candidate, context)),
      reasons: [...candidate.reasons, { code: "market_unlisted" }],
    };
  }

  // CLAUSE (c) — a rookie WITH a recorded draft pick. Draft capital, not the market's own hype
  // pricing, still supplies the model's own opinion (`recomposeRookieSeasonPoints`, above) — but
  // that opinion no longer stands UNCONDITIONALLY against the market (calibration fix round, Task
  // 3): `shrinkTowardMarket` pulls it toward the market's own number in proportion to how THIN the
  // real historical evidence behind this exact pick's curve value is
  // (`rookieCurveEvidenceN` — "n of about 1-2 observations" at the earliest, most speculative picks,
  // the module docblock's own example). A well-evidenced pick barely moves; a razor-thin one — the
  // diagnosed defect, a rookie running back at pick three whose curve knot rested on a single
  // historical comparable — moves substantially. A rookie the draft-pick table has no record of
  // (`overallPick: null` — a UDFA the model still emits a candidate for) has no curve value to
  // substitute at all, so he falls through to the ordinary anchor-plus-evidence path below like
  // anyone else on the market board.
  const rookie = rookieReasonOf(candidate);
  if (rookie !== null && rookie.overallPick !== null) {
    // The rookie curve is fit in PPR points; `formatRatioOf` is the identity under PPR and the
    // candidate's own stat-mix rescale under any other format (its own docblock).
    const modelPoints = recomposeRookieSeasonPoints(candidate, rookie.overallPick, season) * formatRatioOf(candidate, context.rules);
    const evidenceN = rookieCurveEvidenceN(candidate.position, rookie.overallPick);
    const rookiePoints = shrinkTowardMarket(modelPoints, marketEntry.marketPoints, evidenceN);
    return {
      ...candidate,
      perGame: pointsOnlyPerGame(candidate, rookiePoints),
      reasons: [
        ...candidate.reasons,
        { code: "market_anchor", marketPoints: marketEntry.marketPoints, delta: rookiePoints - marketEntry.marketPoints },
      ],
    };
  }

  // `market_anchor.marketPoints` carries THE ANCHOR THIS PLAYER WAS ACTUALLY BLENDED FROM, which is
  // `marketEntry.marketPoints` itself in every null-cell case (props off, or no archived line for
  // him) and the ADP/props blend otherwise. The reason's own contract is "where he started and by how
  // much the blend moved him", and after a props anchor is admitted, where he started is the anchor.
  const anchorPoints = anchorPointsFor(candidate.playerId, marketEntry.marketPoints, context);
  const delta = admittedDelta(candidate, anchorPoints, context);
  const blendedPoints = Math.max(0, anchorPoints + delta);
  return {
    ...candidate,
    perGame: pointsOnlyPerGame(candidate, blendedPoints),
    reasons: [...candidate.reasons, { code: "market_anchor", marketPoints: anchorPoints, delta }],
  };
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
  /**
   * HIS SEASON'S PROPS ANCHOR MAP (fit-round Task 3, deliverable C) — the same per-season map
   * `BlendEvidenceOptions.propsAnchor` carries, attached to the row because a fit's rows span several
   * seasons and each season has its own archive (or none). Absent is the null cell: ADP only.
   *
   * Carrying the whole season's map on every row rather than that player's own single number keeps
   * one shape for "the anchor evidence available at this moment" across the board path and the fit
   * path, so neither can grow a second definition of it.
   */
  readonly propsAnchor?: ReadonlyMap<string, number>;
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

  // ONE context per DISTINCT PROPS ANCHOR (fit-round Task 3): identical arithmetic to blending each
  // row through `blendBoard`, minus a per-row rebuild of the law map, the pricing set and the cluster
  // lookup. A fit's rows span several seasons and each season carries its own anchor map, so the
  // contexts are keyed by that map's own identity — one per season, not one per row, which at this
  // grid's cell count is the difference between thousands of map builds and tens of millions.
  const base = blendContextOf(laws ?? registry(), constants, EMPTY_PROPS_ANCHOR);
  const contextByAnchor = new Map<ReadonlyMap<string, number>, BlendContext>();
  const contextFor = (propsAnchor: ReadonlyMap<string, number> | undefined): BlendContext => {
    if (propsAnchor === undefined) return base;
    const cached = contextByAnchor.get(propsAnchor);
    if (cached !== undefined) return cached;
    const built: BlendContext = { ...base, propsAnchor };
    contextByAnchor.set(propsAnchor, built);
    return built;
  };
  const observations: Observation[] = rows.map((row) => ({
    predicted: seasonPointsOf(blendCandidate(row.candidate, row.market, contextFor(row.propsAnchor), row.season)),
    actual: row.actualPoints,
  }));
  return spearman(observations);
}

/** One grid cell the search scored: the constants it tried, and the score `scoreBlendConstants`
 *  returned for them (`null` exactly when `spearman` itself would be). */
export interface ScoredCell {
  readonly constants: BlendConstants;
  readonly score: number | null;
}

/** What `detectPlateau` found about the neighbourhood around the grid search's own winner. */
export interface PlateauReport {
  /** How many cells (the winner included) scored within `tolerance` of the best score. */
  readonly tiedCellCount: number;
  /** Whether ANY of those tied cells sits at the grid's own ceiling on `lawCapPoints`,
   *  `availabilityCapPoints` or `totalCapPoints` — a plateau reaching the edge of the search means a
   *  wider grid might still move the winner, which a single-cell "best" number cannot say on its own. */
  readonly anyTiedAtCeiling: boolean;
}

/**
 * THE PLATEAU GUARD (fix round 2, ruling 4b — rewritten from an earlier version that only asked
 * whether the SINGLE winning cell sat at the grid's own ceiling). A grid search over a rank
 * correlation routinely produces MANY cells within noise of each other — `scripts/blend-fit.ts`'s own
 * real run found the winner tied, within `tolerance`, with dozens of neighbouring cells — and asking
 * only "is THE winner at the ceiling" can miss a genuine plateau that touches the ceiling somewhere
 * else in the tied set while the arbitrarily-first-sorted winner happens not to. This checks every
 * cell within `tolerance` of `bestScore`, not just the winner itself, and reports both how large that
 * tied set is (so a reader can see "this is a plateau, not a sharp peak") and whether any of it sits
 * at `ceiling` on any of the three cap axes.
 */
export function detectPlateau(cells: readonly ScoredCell[], bestScore: number, ceiling: number, tolerance = 1e-4): PlateauReport {
  const tied = cells.filter((cell) => cell.score !== null && Math.abs(cell.score - bestScore) <= tolerance);
  const anyTiedAtCeiling = tied.some(
    (cell) =>
      cell.constants.lawCapPoints === ceiling || cell.constants.availabilityCapPoints === ceiling || cell.constants.totalCapPoints === ceiling,
  );
  return { tiedCellCount: tied.length, anyTiedAtCeiling };
}

function assertTrainSeasonsFor(rows: readonly BlendTrainRow[], caller: string): void {
  for (const row of rows) {
    if (row.season > BLEND_TRAIN_CUTOFF_SEASON) {
      throw new Error(
        `${caller} was handed a row for ${row.season}, which is past BLEND_TRAIN_CUTOFF_SEASON ` +
          `(${BLEND_TRAIN_CUTOFF_SEASON}) and therefore held out by construction. A fit scored on a ` +
          `season it is later judged on is not a measurement.`,
      );
    }
  }
}

/**
 * FITS `BlendConstants.marketTailByPosition` (fix round 2, ruling 2) — per position, the SMALLEST
 * `marketPoints` any TRAIN listed row carried. By the market curve's own monotone-non-increasing
 * construction (`fitMarketCurve`'s own PAVA guarantee), the smallest `marketPoints` observed IS the
 * curve's value at the deepest ADP rank the train population reached — this is the cheap, exact way
 * to compute "the curve's value at the deepest listed rank" without re-deriving a rank or calling
 * `marketCurve` a second time; the value is already sitting on every `BlendTrainRow`'s own `market`
 * field.
 *
 * THE GATE IS UNCONDITIONAL. A position with zero rows throws — a real train population always has
 * some coverage at every skill position, and a silent `Infinity`/`NaN` tail would be a worse failure
 * than a clear one.
 */
export function fitMarketTailByPosition(rows: readonly BlendTrainRow[]): MarketTailByPosition {
  assertTrainSeasonsFor(rows, "fitMarketTailByPosition");

  const result = {} as Record<CurvePosition, number>;
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    const atPosition = rows.filter((row) => row.candidate.position === position);
    if (atPosition.length === 0) {
      throw new Error(`fitMarketTailByPosition: no train rows at position "${position}" — an empty population is a fit-input bug, not a zero.`);
    }
    result[position] = Math.min(...atPosition.map((row) => row.market.marketPoints));
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
  /** This season's props anchor; see `BlendEvidenceOptions.propsAnchor`. Absent is the null cell, and
   *  a caller that has not loaded an archive simply does not pass one. */
  readonly propsAnchor?: ReadonlyMap<string, number>;
  /**
   * WHICH SCORING FORMAT THE BOARD IS PRICED UNDER (the scoring-formats round, 2026-09-08). Defaults
   * to PPR, the format every board before this round was. Resolves, through `format-anchor.ts`, to
   * the format's own ADP feed, its own fitted curve, its own preset for the raw arm and the rookie
   * rescale, and its own unlisted tail on top of `constants`. The raw arm (`raw: true`) is
   * format-free: it returns the model's per-game lines, which `preseasonBoard` scores under whatever
   * rules the caller hands it.
   */
  readonly format?: BoardFormat;
}

/** How many LISTED market players a position needs before a LIVE board trusts its own pricing for
 *  that position — named and documented here rather than left as a bare literal at the call site,
 *  the same discipline `MINIMUM_RESOLUTION` (`preseason-ingest.ts`) and `MINIMUM_AGREEMENT`
 *  (`derived-stat-lines.ts`) already keep for their own thresholds. Five is deliberately generous:
 *  a real twelve-team league starts at most 2-3 players per skill position, so five listed players
 *  is still a thin market by any normal season's standard, but it is enough for
 *  `tailCappedUnlistedPoints`'s own tail (a real quantile of REAL listed prices) to mean something
 *  rather than being a single, arbitrary fitted constant every unlisted candidate collapses onto. */
export const MINIMUM_LISTED_PER_POSITION = 5;

/**
 * THE DEGENERACY GUARD (Task 4 fix round ruling, found by the first real live persist this engine
 * ever ran) — NOW A PER-POSITION COVERAGE FLOOR (Task 4 fix round 2, I1), not only a whole-board
 * zero check. The original version caught the incident it was built for (every position 100%
 * unlisted, all 759 candidates tail-capped) but would have missed the SAME failure mode confined to
 * ONE position — twenty-six tied QBs sitting on an otherwise healthy, well-anchored board, which is
 * exactly as dishonest a number but would not have tripped `market.length === 0`.
 *
 * TWO CHECKS, BOTH SCOPED TO `momentKind === "live"` (a REPLAY board with a thin or unbenchmarked
 * historical season's market is an established, already-tested, legitimate state — see the
 * existing `raw: false` fixture in `source.test.ts`, which relies on exactly this staying silent):
 *
 *   1. ZERO LISTED PLAYERS OVERALL — the original guard, kept as an unconditional safety net rather
 *      than folded entirely into the per-position check below, because the per-position check is
 *      SCOPED TO POSITIONS `candidates` (our own model board) ACTUALLY CONTAINS. A board with an
 *      empty `candidates` array (nothing of our own to price at all — a real, if narrow, state a
 *      test can construct) would iterate zero positions in the per-position loop and never notice a
 *      wholly empty market; this check catches that case regardless of what `candidates` contains.
 *   2. PER POSITION, AMONG THE POSITIONS `candidates` ACTUALLY HAS SOMEONE AT: fewer than
 *      `MINIMUM_LISTED_PER_POSITION` listed market players for that position refuses, naming every
 *      thin position at once rather than stopping at the first.
 *
 * Never a defence against a NORMAL board with a fully anchored market: `tailCappedUnlistedPoints`'s
 * fallback exists precisely because a real board always carries some unlisted deep-bench players,
 * and that is fine — this guard fires only when a whole POSITION has too few real prices to anchor
 * against, the shape a market blackout (this task's own incident) or a genuinely thin future season
 * produces.
 */
export function assertLiveMarketCoverage(
  inputs: Pick<PreseasonInputs, "season" | "moment" | "momentKind">,
  candidates: readonly BoardCandidate[],
  market: readonly MarketPriorEntry[],
): void {
  if (inputs.momentKind !== "live") return;
  if (market.length === 0) {
    throw new Error(
      `${inputs.season}'s LIVE board resolved ZERO listed market players at ${inputs.moment.toISOString()}. ` +
        "Every candidate would fall back to the position tail cap, degenerately tying every player at a " +
        "position to the identical value -- this board must not be persisted. The usual cause is the ADP " +
        "benchmark's own publication stamp sitting after the live moment (publishers.ts's " +
        "fetchAverageDraftPosition docblock): verify the benchmark is ingested AND visible at this moment " +
        "before persisting again.",
    );
  }
  const listedCountByPosition = new Map<Position, number>();
  for (const entry of market) {
    listedCountByPosition.set(entry.position, (listedCountByPosition.get(entry.position) ?? 0) + 1);
  }
  const positionsOnBoard = new Set(candidates.map((candidate) => candidate.position).filter(isCurvePosition));
  const thin = [...positionsOnBoard]
    .map((position) => ({ position, listed: listedCountByPosition.get(position) ?? 0 }))
    .filter(({ listed }) => listed < MINIMUM_LISTED_PER_POSITION)
    .sort((a, b) => (a.position < b.position ? -1 : 1));
  if (thin.length > 0) {
    const named = thin.map(({ position, listed }) => `${position} (${listed} listed)`).join(", ");
    throw new Error(
      `${inputs.season}'s LIVE board resolves fewer than ${MINIMUM_LISTED_PER_POSITION} listed market players at ` +
        `${named} at ${inputs.moment.toISOString()}. Every unlisted candidate at a position this thin would fall ` +
        "back to the SAME position tail cap, degenerately tying most or all of that position's own board rows " +
        "-- this board must not be persisted. Verify the ADP benchmark is ingested AND visible at this moment " +
        "for the named position(s) before persisting again.",
    );
  }
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
  options: ShippedCandidatesOptions = {},
): Promise<readonly BoardCandidate[]> {
  return (await shippedPreseasonBoardInputs(db, inputs, priors, options)).candidates;
}

/** What a shipped build hands the board and the store: the candidates the gate let through, and
 *  the players it took off the board with their dated status (`roster-status-gate.ts`). */
export interface ShippedBoardInputs {
  readonly candidates: readonly BoardCandidate[];
  readonly exclusions: readonly ExcludedCandidate[];
  /** What the roster sweep the gate read actually covered (`SweepCoverage`); `null` with no capture.
   *  An incomplete sweep excluded nobody on absence alone, and the persist prints it. */
  readonly sweep: SweepCoverage | null;
}

/** The stamp the roster ingest claims for this season's week-one file, read off the rows
 *  `loadPreseason` already holds rather than re-derived — the one date `roster-status-read.ts`
 *  will not invent for itself. */
function weekOneRosterStampOf(inputs: PreseasonInputs): Date {
  return inputs.roster.reduce((latest, row) => (row.asOf > latest ? row.asOf : latest), inputs.roster[0]?.asOf ?? inputs.moment);
}

/**
 * THE ROSTER-STATUS GATE, applied to the candidates BEFORE the blend (founder report 2026-09-08).
 * Before, so a reserve-list player's capped games are what the blend's own availability delta
 * reads, and so a player off an active roster is never anchored to an ADP slot at all. Both arms
 * pass through it: a status is a fact about the roster, not a modelling choice one arm may skip.
 */
async function gated(db: ReadonlyDb, inputs: PreseasonInputs, candidates: readonly BoardCandidate[]): Promise<ShippedBoardInputs> {
  const { statuses, sweep } = await rosterStatusesAsOf(db, {
    season: inputs.season,
    asOf: inputs.moment,
    playerIds: candidates.map((candidate) => candidate.playerId),
    weekOneStampedAt: weekOneRosterStampOf(inputs),
    // A LIVE moment is before the season's first kickoff by construction (`liveMomentFor`), so
    // its sweep is a cutdown roster; a replay moment is a played season's.
    phase: inputs.momentKind === "live" ? "cutdown" : "in_season",
  });
  return { ...gateCandidates(candidates, statuses, inputs.season), sweep };
}

/** `shippedPreseasonCandidates` with the gate's exclusions beside the candidates — what the persist
 *  script and the report read, so the store can keep the excluded players under their band. */
export async function shippedPreseasonBoardInputs(
  db: ReadonlyDb,
  inputs: PreseasonInputs,
  priors: PreseasonPriors,
  { raw = false, features = SHIPPED_PRESEASON_FEATURES, constants, laws, propsAnchor, format = DEFAULT_BOARD_FORMAT }: ShippedCandidatesOptions = {},
): Promise<ShippedBoardInputs> {
  // THE RAW ARM IS BUILT FROM THE COMMITTED PRIORS, UNTOUCHED (fit-round Task 3, deliverable D): the
  // blend's own fitted availability recency applies to the BLENDED board only. See
  // `BlendConstants.availabilityRecencyDecay`'s own docblock for why the comparison arm must not move
  // with the thing it is comparing against.
  if (raw) return gated(db, inputs, preseasonCandidates(inputs, features, priors));

  const anchor = formatAnchorFor(format);
  const blendConstants = blendConstantsFor(constants ?? FITTED_BLEND_CONSTANTS, format);
  const { candidates, exclusions, sweep } = await gated(db, inputs, preseasonCandidates(inputs, features, withBlendAvailabilityRecency(priors, blendConstants)));
  // `inputs.moment` — never a second, internal `preseasonMomentFor` call — so a LIVE board's market
  // prior is taken at the SAME moment the rest of the board was built at (Task 4, `curve.ts`'s own
  // `marketBoard` docblock: that function used to derive this itself, unconditionally through the
  // replay-only `preseasonMomentFor`, which throws for a season that has not kicked off yet).
  const { entries: market, droppedCount } = await marketBoard(db, inputs.season, inputs.moment, anchor.curve, anchor.adpSource);
  assertLiveMarketCoverage(inputs, candidates, market);
  if (droppedCount > 0) {
    // "No curve" and not "unresolved": since the 2026-09-05 round the market board legitimately
    // carries kickers and team defences (43 of them for 2025), and `marketBoard` drops them because
    // `isCurvePosition` has no fitted rank-to-points curve for either. That is deliberate, it is
    // what keeps the skill blend untouched, and an operator reading "unresolved" every run would
    // reasonably go looking for an identity bug that is not there.
    console.warn(
      `market/blend.ts: marketBoard for ${inputs.season} dropped ${droppedCount} ADP row(s) whose position has no fitted market curve.`,
    );
  }
  const blended = blendBoard(market, candidates, { season: inputs.season, constants: blendConstants, laws, propsAnchor, rules: anchor.rules });
  return { candidates: [...blended, ...(await kdefCandidatesFor(db, inputs, anchor.rules))], exclusions, sweep };
}

/**
 * THE TWO POSITIONS THE BLEND DOES NOT TOUCH (the 2026-09-05 kicker and team defence round).
 *
 * APPENDED AFTER `blendBoard`, NEVER THROUGH IT. `blendBoard` anchors a candidate to the market's
 * own rank-to-points curve, and `market/curve.ts` fitted no curve for either position — which is
 * exactly why `marketBoard` drops their rows and why the four skill positions' board did not move
 * when the market benchmark learned to see them. Running them through a blend calibrated on skill
 * players would be applying a correction measured on one population to another.
 *
 * AND FOR NOW IT RETURNS NOTHING AT ALL, because the single 2025 judgment failed both positions and
 * `KDEF_DECISION` says so. That is the strong reading of the spec's own fallback, and it is
 * deliberate: emitting rows carrying zero points so the position still appears would put a
 * fabricated number in front of every reader and every consumer that sorts by points. A zero is not
 * "no opinion", it is "we project nothing", which is a different and false claim. The board surface
 * reads `KDEF_DECISION` and shows the market's own order instead.
 *
 * The builder is fully wired anyway, and that is the point: a later round whose judgment passes
 * flips one constant in `kdef-decision.ts` and these rows appear, with no plumbing left to write.
 */
async function kdefCandidatesFor(db: ReadonlyDb, inputs: PreseasonInputs, rules: ScoringRules): Promise<readonly BoardCandidate[]> {
  const shipping = KDEF_POSITIONS.filter((position) => shipsProjectedRows(position));
  if (shipping.length === 0) return [];
  const history = await loadKdefHistory(db, kdefHistorySeasonsFor(inputs.season), inputs.moment);
  const roster = await preseasonRostersAsOf(db, { season: inputs.season, asOf: inputs.moment });
  return kdefCandidates({
    season: inputs.season,
    roster,
    history,
    kicker: FITTED_KICKER_PRIORS,
    defence: FITTED_DEFENSE_PRIORS,
    rules,
  }).filter((candidate) => shipping.includes(candidate.position));
}

/**
 * THE PRIORS THE BLENDED BOARD IS BUILT FROM — the caller's own, with `availabilityRecencyDecay`
 * applied if the fit committed one. Returns the caller's object BY REFERENCE at the null cell (no
 * fitted decay), so the incumbent board is reproduced bit for bit rather than through a copy.
 */
function withBlendAvailabilityRecency(priors: PreseasonPriors, constants: BlendConstants): PreseasonPriors {
  const decay = constants.availabilityRecencyDecay;
  if (decay === undefined) return priors;
  return { ...priors, availability: withAvailabilityRecency(priors.availability, decay) };
}
