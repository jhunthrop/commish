import type { ReadonlyDb } from "@/db/client";
import { STAT_FIELDS, type StatLine } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { spearman, type Observation } from "../metrics";
import { teamGamesIn } from "../preseason/availability";
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
import { marketBoard, type MarketPriorEntry } from "./curve";

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
 * expects him to play and the market's own implicit assumption that everybody plays a full season,
 * or — for a rookie — the draft-capital curve replacing the market's own rookie-hype pricing
 * outright. Every other layer of the model (scheme, offseason redistribution, depth chart, career
 * stage, the model's own opportunity-times-efficiency arithmetic) never gets a vote here: it has
 * already had its say by producing the `BoardReason`s this module reads, and NOTHING beyond those
 * named reasons is allowed to move a player off market.
 *
 * THE IDENTITY THIS DESIGN RESTS ON: a player with no admitted evidence — no confirmed law fired
 * for him, and his expected games exactly match the market's own full-season assumption — gets
 * `marketPoints` back EXACTLY, not "close to it." `blendBoard.test.ts` pins this, because it is the
 * whole point: the model does not get to quietly outvote the market where it has nothing specific
 * to say.
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
 * The one field the synthetic per-game line carries its points in: `receivingYards`, weighted a
 * flat 0.1 points/yard in `PPR_SCORING` with NO position-conditional bonus (unlike `receptions`,
 * which carries the TE bonus) and no threshold or tier logic (unlike the DEF-only tables). Every
 * position this blend ever runs for — QB, RB, WR, TE — scores it identically, so one field can
 * carry an exact points value regardless of which position the candidate plays.
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
}

export interface BlendEvidenceOptions {
  /** The season being blended — `teamGamesIn(season)` is the market's own implicit assumption that
   *  clause (b) measures a gap against. */
  readonly season: number;
  /** Defaults to the committed, grid-searched `FITTED_BLEND_CONSTANTS`. A caller (a test, or the
   *  fit script's own scoring loop) passes its own to drive the blend with different caps. */
  readonly constants?: BlendConstants;
}

/** A full season's worth of games — the fixed reference `FULL_SEASON_GAMES` normalizes a law's
 *  exposure-scaled delta against. Deliberately NOT `teamGamesIn(season)`: the exposure fraction
 *  below is a fixed calibration of a law's own scale (see clause (a)'s docblock on `blendBoard`),
 *  not a per-season game count, and `teamGamesIn` already supplies the per-season count clause (b)
 *  needs for its own, separate ratio. */
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

/**
 * ONE PLAYER'S BLENDED SEASON POINTS, from his market entry (if he has one) and every reason his
 * model candidate already carries.
 *
 * CLAUSE (a), CONFIRMED LAWS: for each `"law"` reason already on the candidate — attached upstream,
 * unconditionally, by `preseason/source.ts`'s `loadPreseason`/`lawReasonsFor` for every CONFIRMED
 * law whose condition holds for him — the law's own registry-measured `effect` (a points/GAME
 * delta, `LawMeasurement.effect`'s own docblock) is scaled by this player's OWN exposure,
 * `expectedGames / FULL_SEASON_GAMES`, then capped at `lawCapPoints`. THE BRIEF'S OWN RULING: this
 * exposure fraction is a deliberate, documented simplification — "effect × EXPECTED_GAMES/17 is
 * acceptable" — chosen over a bare `effect × expectedGames` (which would be the dimensionally
 * literal per-game-to-season conversion) because it additionally DAMPENS every law's applied delta
 * by a factor of `FULL_SEASON_GAMES`, keeping a single confirmed law's nudge modest before the cap
 * even engages. That is intentional conservatism, not an approximation error: this board spends
 * disagreement sparingly, and a law's own bootstrap CI is real evidence but not certainty.
 *
 * CLAUSE (b), THE AVAILABILITY GAP: the market's own number assumes every player plays his team's
 * whole season (`teamGamesIn(season)`) — nobody publishes ADP points net of an injury discount. The
 * model's own `expectedGames` (Task 1's availability model) is the one number this engine has that
 * the market implicitly does not. The gap between them, `expectedGames - teamGames`, is converted
 * to season points via the market's OWN implied per-game rate (`marketPoints / teamGames`) — the
 * only rate available that is anchored to THIS player's own market price rather than a positional
 * average — then capped at `availabilityCapPoints`. Positive when the model expects MORE games than
 * a full season would imply (never true of a real availability outlook, whose ceiling is
 * `teamGames` itself, but a real possibility for a hand-built candidate a caller passes directly);
 * negative, the common real case, when the model expects fewer.
 *
 * CLAUSE (c), ROOKIES: handled directly inside `blendBoard`, before this function is ever called —
 * a full substitution of `marketPoints` by `rookieCurve`, not an additive delta, so neither clause
 * above ever runs for a rookie with a recorded draft pick.
 *
 * NEITHER CLAUSE READS ANYTHING BEYOND WHAT THE CANDIDATE ALREADY CARRIES. `magnitude` (a law
 * reason's own player-specific fact) is intentionally UNUSED here: `effect` is the one number every
 * confirmed law's registry entry already measured as the points/game delta ITS OWN CONDITION
 * PREDICTS, and re-deriving a different scaling from `magnitude` would be inventing a second,
 * unmeasured effect size per player. `lawReasonsFor` (`laws/board-reasons.ts`) already decided which
 * laws fired; this function's only job is turning "fired" into "how many points."
 */
function admittedDelta(candidate: BoardCandidate, marketPoints: number, teamGames: number, constants: BlendConstants): number {
  const exposure = candidate.games.expected / FULL_SEASON_GAMES;
  let lawTotal = 0;
  for (const reason of candidate.reasons.filter(isLawReason)) {
    lawTotal += clampAbs(reason.effect * exposure, constants.lawCapPoints);
  }

  const availabilityGap = candidate.games.expected - teamGames;
  const availabilityDelta = clampAbs((availabilityGap * marketPoints) / teamGames, constants.availabilityCapPoints);

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
 */
export function blendBoard(market: readonly MarketPriorEntry[], model: readonly BoardCandidate[], evidence: BlendEvidenceOptions): readonly BoardCandidate[] {
  const constants = evidence.constants ?? FITTED_BLEND_CONSTANTS;
  const teamGames = teamGamesIn(evidence.season);
  const marketByPlayer = new Map(market.map((entry) => [entry.playerId, entry] as const));

  return model.map((candidate) => {
    const marketEntry = marketByPlayer.get(candidate.playerId);
    if (marketEntry === undefined) {
      return { ...candidate, reasons: [...candidate.reasons, { code: "market_unlisted" }] };
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
      return { ...candidate, perGame: pointsOnlyPerGame(candidate, rookiePoints) };
    }

    const delta = admittedDelta(candidate, marketEntry.marketPoints, teamGames, constants);
    const blendedPoints = Math.max(0, marketEntry.marketPoints + delta);
    return { ...candidate, perGame: pointsOnlyPerGame(candidate, blendedPoints) };
  });
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
 */
export function scoreBlendConstants(rows: readonly BlendTrainRow[], constants: BlendConstants, { heldOutSeasons }: BlendScoreOptions): number | null {
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
    const [blended] = blendBoard([row.market], [row.candidate], { season: row.season, constants });
    return { predicted: seasonPointsOf(blended!), actual: row.actualPoints };
  });
  return spearman(observations);
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
  /** Defaults to the committed `FITTED_BLEND_CONSTANTS`; a caller may override for testing. */
  readonly constants?: BlendConstants;
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
 */
export async function shippedPreseasonCandidates(
  db: ReadonlyDb,
  inputs: PreseasonInputs,
  priors: PreseasonPriors,
  { raw = false, features = SHIPPED_PRESEASON_FEATURES, constants }: ShippedCandidatesOptions = {},
): Promise<readonly BoardCandidate[]> {
  const candidates = preseasonCandidates(inputs, features, priors);
  if (raw) return candidates;
  const { entries: market } = await marketBoard(db, inputs.season);
  return blendBoard(market, candidates, { season: inputs.season, constants });
}
