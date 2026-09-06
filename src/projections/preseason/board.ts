import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { computeFantasyPoints, type ScoringRules } from "@/scoring/compute";
import type { ProjectionDistribution } from "../decide/outlook";
import { valueBoard, type LeagueShape, type SeasonProjection, type ValuedPlayer } from "../decide/replacement";
import { tiersOf } from "../decide/tiers";
import type { GamesPlayedOutlook } from "./availability";
import { SHIPPED_GAME_VARIANCE } from "./fitted-variance";
import { seasonPointsInterval, VARIANCE_POSITIONS, Z90, type GameVariancePriors, type PlayerClass, type VariancePosition } from "./game-variance";

/**
 * THE PRESEASON BOARD — every player ranked before a ball is thrown, in one league's own scoring.
 *
 * This is the commercial centre of the engine and the thing the founder named: "performance
 * rankings for the season on how players are ranked before any games are played." Everything below
 * it in this directory produces one of the three numbers it multiplies together.
 *
 * SEASON POINTS = EXPECTED GAMES x PER-GAME OPPORTUNITY x EFFICIENCY, per component, and the
 * components are scaled BEFORE the league's rules are applied rather than after. Scoring is linear
 * in the components, so the two orders agree to the last decimal — but scaling the components keeps
 * the intermediate a reviewer wants to argue with ("we think he sees 128 targets") on the board
 * itself, and it means a format with a reception bonus at one position gets the bonus on the season
 * total rather than on a per-game number somebody multiplied afterwards.
 *
 * ORDERED BY PROJECTED POINTS, WITH VALUE OVER REPLACEMENT AS A SECOND, LABELLED VIEW. The first
 * two versions of this board were ordered by value over replacement and both measured worse than
 * their own points column: 0.6559 against 0.6839 in 2023 and 0.7075 against 0.7385 in 2024, and
 * points won in almost every band against both published benchmarks
 * (`docs/research/2026-08-27-preseason-board.md`). Phase 5 named the mechanism before this board
 * existed: value over replacement subtracts a replacement level estimated from the same noisy
 * projections and then re-ranks aggressively ACROSS positions, so it AMPLIFIES board error rather
 * than absorbing it. A better board reduces the error being amplified; it does not stop the
 * amplification. The measurement decides the default and it says points.
 *
 * REPLACEMENT LEVEL IS STILL THE RIGHT IDEA FOR A DRAFT, which is why it is kept rather than
 * deleted. `decide/replacement.ts` makes the argument in full and it is correct: a quarterback who
 * scores 330 and a back who scores 300 are not a thirty-point gap when the twelfth quarterback
 * scores 290 and the thirty-first back scores 150. That argument is about WHAT A PICK IS WORTH TO A
 * ROSTER, and it is a different question from "who scores more", which is what a rank correlation
 * against season points measures. So every entry carries both numbers and both ranks: `rank` is the
 * board's own order and is by points, `valueRank` is the draft-value view and is by value over
 * replacement. `byValueOverReplacement` returns the second.
 *
 * WITHIN A POSITION THE TWO ORDERS ARE IDENTICAL, and that is worth stating because it bounds the
 * whole disagreement. Value over replacement subtracts a constant per position, so it can only ever
 * change how positions INTERLEAVE. Everything computed per position — the tiers below, the
 * position rank, the cliff — is the same under either order, and the choice of default changes
 * nothing except where the quarterbacks sit relative to the backs.
 */

/**
 * A reason a player sits where he sits. STRUCTURED, never generated prose.
 *
 * The spec's layer 7 says diagnostics and product are the same artifact: what tells us the model is
 * wrong is what tells a manager why a player ranks there. That only works if a reason is a value
 * with fields — something a test can assert on, a surface can render in its own words, and a
 * regression can be measured against. A sentence would be none of those, and in a product where
 * entry fees ride on the output an invented sentence is unacceptable.
 */
export type BoardReason =
  | { readonly code: "availability"; readonly expectedGames: number; readonly floorGames: number; readonly ceilingGames: number }
  | { readonly code: "offseason_share_gained"; readonly targetShare: number; readonly carryShare: number }
  | { readonly code: "offseason_share_lost"; readonly targetShare: number; readonly carryShare: number }
  | { readonly code: "changed_team"; readonly from: string; readonly to: string }
  | { readonly code: "new_play_caller"; readonly team: string }
  | { readonly code: "rookie"; readonly overallPick: number | null; readonly landingMultiplier: number }
  | { readonly code: "scarcity"; readonly positionRank: number; readonly replacementLevel: number }
  | { readonly code: "tier_cliff"; readonly playersLeftInTier: number; readonly dropToNextTier: number }
  /**
   * Task 10 (`market/blend.ts`'s `blendBoard`) could not find this player on the market's own ADP
   * board, so his season points are `Math.min(rawModelPoints, marketTailByPosition[position])` —
   * the raw model's own number, capped so he can never outrank the market's own cheapest drafted man
   * at his position (`market/blend.ts`'s `tailCappedUnlistedPoints`, fix round 3, IMPORTANT 1 —
   * SIMPLIFIED from an earlier two-layer version that also ran an affine rescale first). Since the
   * cap can bind, his final number is NOT always a pure, unedited model output; the reason itself
   * carries no field that says whether it did, so neither this docblock nor `reason-chip.tsx`'s
   * copy for this code claims one way or the other. NOT a claim that the model is wrong about him —
   * an unranked player is usually a deep camp body neither a real draft board nor `blendBoard` has an
   * opinion worth blending — only that the two numbers a manager can compare on every other row (what
   * the market thinks, what evidence moved him off it) do not exist for this one.
   */
  | { readonly code: "market_unlisted" }
  /**
   * I6 (fix round, 2026-08-31) — on every LISTED blended candidate, the market entry `blendBoard`
   * anchored him to and the total admitted delta it moved him by: his blended season points are
   * `marketPoints + delta`, FLOORED AT ZERO (fix round 2 — an earlier version of this docstring said
   * "exactly," overstating it; `blendBoard`'s own `Math.max(0, marketPoints + delta)` can clip a
   * large enough negative delta). Lets a reader see not just WHAT moved a player (the law/
   * availability reasons already on the list) but WHERE he started and BY HOW MUCH the blend
   * actually spent. `delta` can be negative (moved below market), zero (no admitted evidence, or
   * every admitted delta capped to nothing), or — for a listed rookie — `rookieCurve − marketPoints`,
   * an uncapped full substitution rather than an additive term. M8 RULING: deliberately excluded
   * from `reason-chip.tsx`'s `strongestLawReasons` (the two-chip compact board surface stays
   * LAW-ONLY); renders only where a full reason list does, e.g. PlayerPeek's own outlook.
   */
  | { readonly code: "market_anchor"; readonly marketPoints: number; readonly delta: number }
  /**
   * A CONFIRMED law (`laws/registry.ts`), TRIBAL OR DISCOVERED, whose own condition is true for this
   * player, for the season this board projects. `effect` is the law's REGISTRY-MEASURED points/game
   * delta (`Law.measured.effect`, the same number every law carries everywhere else it is shown) —
   * never recomputed per player. `magnitude` is the player's OWN value of the exact quantity that
   * law's condition reads, so the reason says not just "this law applies" but "by how much"; its
   * unit depends on `lawId` and is documented in full at `laws/board-reasons.ts`'s `magnitudeForLaw`
   * for a tribal law (touches for `rb_workload_cliff`, years for `rb_age_curve`, a target-share
   * fraction for `wr_target_competition` and `target_share_persistence`, a share-over-threshold
   * ratio for `td_regression`, pass-rate-over-expected for `play_caller_fingerprint`) and at that same
   * module's `magnitudeForDiscoveredLaw` for a discovered one (the primary quantity's own current-
   * season value, per `discovery/templates.ts`'s `primaryQuantityIdOf`). Built by
   * `laws/board-reasons.ts`'s `lawReasonsFor`, the one place a candidate's facts become this variant.
   */
  | { readonly code: "law"; readonly lawId: string; readonly effect: number; readonly magnitude: number }
  /**
   * A kicker with no kicking history at all in the seasons this board reads — a rookie, or a man
   * who has never held the job. His attempt volume comes from the club he signed with and his make
   * rates are the league's own, and this reason is how the row SAYS SO rather than presenting a
   * league mean as if it were a measurement of him.
   */
  | { readonly code: "kicker_no_history" }
  /**
   * What a kicker's projection is actually built from, and the three numbers a reader can argue
   * with: his club's own field-goal and extra-point attempts a game (shrunk toward the league by
   * how many games of that club this board has seen) and his own field-goal make rate (shrunk
   * toward the league by his own attempt count). Attempts travel with the offence and make rates
   * travel with the man, which is the whole reason this beats a last-season-points order.
   */
  | {
      readonly code: "kicker_opportunity";
      readonly fieldGoalAttemptsPerGame: number;
      readonly extraPointAttemptsPerGame: number;
      readonly fieldGoalMakeRate: number;
    }
  /**
   * A team defence with no defensive history in the seasons this board reads — an expansion club, or
   * a season the archive does not cover. Every component is the league's own, and this reason is how
   * the row says so rather than presenting a league mean as a measurement of this club.
   */
  | { readonly code: "defense_no_history" }
  /**
   * What a team defence's projection is built from: sacks and takeaways a game (each shrunk toward
   * the league by the club's own game count) and the points the tier tables award, AVERAGED over the
   * club's own shrunk per-game distribution rather than read off its average. Those tables are step
   * functions, and the expectation of a step function is not the step function of the expectation.
   */
  | {
      readonly code: "defense_takeaways";
      readonly sacksPerGame: number;
      readonly takeawaysPerGame: number;
      readonly tierPointsPerGame: number;
    };

/** One player as the board receives him: a per-game line, a games distribution, and his causes. */
export interface BoardCandidate {
  readonly playerId: string;
  readonly position: Position;
  readonly team: string;
  /** Layer 3's predicted line for ONE game. `week` on it is not read. */
  readonly perGame: StatLine;
  readonly games: GamesPlayedOutlook;
  /**
   * THE NONLINEAR PART OF A TEAM DEFENCE'S SCORE, ALREADY AVERAGED, IN POINTS PER GAME (the
   * 2026-09-05 kicker and team defence round).
   *
   * Points allowed and yards allowed are scored through step tables (`scoring/compute.ts`'s
   * `POINTS_ALLOWED_TIERS` and `YARDS_ALLOWED_TIERS`), and the expectation of a step function is
   * not the step function of the expectation. A defence that allows 13 one week and 27 the next
   * averages 20 and scores 1 point on that average, while the two real weeks score 3 and 0 for an
   * average of 1.5. So `team-defense.ts` averages the tier function over the team's own shrunk
   * per-game distribution and hands the result here, and the `perGame` line it hands over carries
   * NO `pointsAllowed` and NO `yardsAllowed` at all — which `computeFantasyPoints` already reads,
   * correctly, as "not recorded".
   *
   * ABSENT for every other position and for every skill candidate, which is why adding it changed
   * no existing board row. Both `perGamePoints` and `projectedPoints` add it (times the game count,
   * for the season figure) and both are unchanged when it is absent.
   */
  readonly perGameTierPoints?: number;
  /**
   * HOW WRONG THIS CANDIDATE'S OWN PROJECTION TYPICALLY IS, in season points squared (the 2026-09-05
   * kicker and team defence round). Feeds `seasonPointsInterval`'s third variance term.
   *
   * ABSENT for every skill candidate, which is why adding it moved no existing row, and that absence
   * is an honest "not measured yet" rather than a claim of zero: this round measured the quantity
   * for the two positions it fitted and for no others. The band a skill player carries is therefore
   * still outcome noise only, exactly as it was, and the two new positions carry the wider and more
   * honest interval. A later round that measures it for the four skill positions closes the gap; see
   * `seasonPointsInterval`'s own docblock for why an interval without this term understates itself.
   */
  readonly seasonProjectionErrorVariance?: number;
  /** Reasons discovered upstream, before scarcity and tiers are known. */
  readonly reasons: readonly BoardReason[];
}

export interface PreseasonBoardOptions {
  readonly season: number;
  /** The moment the board was taken. Carried for provenance; nothing here reads a store. */
  readonly asOf: Date;
  readonly rules: ScoringRules;
  readonly shape: LeagueShape;
  /**
   * PER-GAME PERFORMANCE VARIANCE (calibration fix round, 2026-09-04, Task 4) — defaults to the
   * committed `SHIPPED_GAME_VARIANCE` (`fitted-variance.ts`, the two generated halves composed), exactly like `rules`/`shape` are the only things a caller
   * normally has to supply at all. A test (or a future fit script) passes its own to drive the band
   * with different cells; see `game-variance.ts`'s own module docblock for what this measures and
   * why it is fit separately from the rest of the model.
   */
  readonly gameVariance?: GameVariancePriors;
}

export interface BoardEntry extends ValuedPlayer {
  /** 1-based overall rank, by PROJECTED POINTS. The board's own order; see the module docblock. */
  readonly rank: number;
  /** 1-based overall rank by value over replacement. The draft-value view, never the default. */
  readonly valueRank: number;
  readonly team: string;
  readonly expectedGames: number;
  /** The season line the points were composed from — the intermediate worth arguing with. */
  readonly seasonLine: StatLine;
  /**
   * Season points at the tenth, fiftieth and ninetieth percentiles — COMPOSED FROM BOTH SOURCES
   * (calibration fix round, Task 4): per-game performance variance (`game-variance.ts`, fit on real
   * week-level observations) AND the games-played distribution (`availability.ts`). Before this
   * round the band varied ONLY the games-played term, so two players with identical availability
   * outlooks but very different week-to-week per-game swings got an identical band — mislabelling
   * availability risk as the whole of outcome range. `BoardRow.floorPoints`/`ceilingPoints` keep
   * their name; this is a documented change to what the numbers underneath them mean.
   */
  readonly outlook: ProjectionDistribution;
  /** 0-based tier within his position, from `decide/tiers.ts`' games-worth rule. See `overlapTiers`. */
  readonly tier: number;
  readonly playersLeftInTier: number;
  readonly dropToNextTier: number;
  readonly reasons: readonly BoardReason[];
}

/**
 * THE SCORED FIELDS THAT ARE NOT IN `STAT_FIELDS` AND SCALE LINEARLY ANYWAY (the 2026-09-05 kicker
 * and team defence round).
 *
 * `STAT_FIELDS` is the canonical list two OTHER readers walk (the per-tick digest and the provider
 * contract suite, see `domain/player.ts`), and widening it would make every stats provider owe
 * numbers it may not have. But `computeFantasyPoints` scores every field below, and a kicker's
 * misses and a defence's fumble recoveries and safeties are per-game quantities that multiply by a
 * game count exactly the way a reception does. Left out, a kicker's season line would carry his
 * makes and not his misses, and a defence would forfeit every takeaway that was not an interception.
 *
 * SCALED ONLY WHERE PRESENT, which is what makes this change invisible to every board row that
 * existed before it: `composeStatLine` (`model/compose.ts`) emits `STAT_FIELDS` and nothing else, so
 * every QB, RB, WR and TE candidate carries `undefined` for all of these, and `undefined` stays
 * `undefined`.
 *
 * `pointsAllowed` AND `yardsAllowed` ARE DELIBERATELY ABSENT FROM THIS LIST. They are scored through
 * nonlinear tier tables (`scoring/compute.ts`), so seventeen games of points allowed is not a
 * quantity those tables can read at all. A defence's expected tier points ride on
 * `BoardCandidate.perGameTierPoints` instead.
 */
const SCALED_OPTIONAL_FIELDS = [
  "twoPointConversions",
  "fieldGoalsMissed",
  "extraPointsMissed",
  "kickReturnTouchdowns",
  "puntReturnTouchdowns",
  "defensiveFumblesRecovered",
  "safeties",
] as const satisfies readonly (keyof StatLine)[];

/** Every component multiplied by a number of games. Scoring is applied after, never before. */
export function scaleStatLine(line: StatLine, games: number): StatLine {
  if (!(games >= 0) || !Number.isFinite(games)) {
    throw new Error(`A season line is a per-game line times a finite number of games; got ${games}.`);
  }
  const optional = Object.fromEntries(
    SCALED_OPTIONAL_FIELDS.flatMap((field) => {
      const value = line[field];
      return value === undefined ? [] : [[field, value * games] as const];
    }),
  );
  return {
    ...line,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, line[field] * games])) as Omit<StatLine, "playerId" | "week">),
    ...optional,
  };
}

/**
 * THE SPEC'S OWN CLIFF RULE, IMPLEMENTED AND THEN MEASURED — and the measurement rejects it.
 *
 * WHERE A POSITION FALLS OFF, from the distributions rather than from the gaps.
 *
 * The engine spec's layer 6 asks for exactly this: "a cliff is where the gap exceeds the overlap,
 * not a hand-drawn line." `decide/tiers.ts` could not implement it and says so in its own docblock —
 * "we have no per-player overlap to compare against yet, nothing in the model emits a distribution"
 * — so it compares each gap to the position's typical gap instead, which is a stated comparison
 * against a real population but is not the rule the spec wrote down.
 *
 * This board emits a distribution, so the real rule is available. Two adjacent players' season-point
 * intervals either overlap or they do not: the overlap is `min(ceilings) - max(floors)`, clipped at
 * zero, and a cliff is a gap wider than it. Two men whose plausible seasons do not intersect are in
 * different tiers by any honest reading; two whose intervals sit on top of each other are not, and
 * a tier line drawn between them would be telling a manager something the model does not know.
 *
 * AND IT FINDS NO CLIFFS AT ALL, which is why the board does not ship it. Measured on both
 * held-out seasons it returns exactly one tier at every position. The reason is arithmetic rather
 * than a bug: the only distribution this engine emits is availability, its tenth-to-ninetieth span
 * is roughly a sixth of a player's season, and on a board carrying two hundred and sixty-five
 * receivers the gap between adjacent men is a fraction of that. Two adjacent players are genuinely
 * indistinguishable given what we can currently say about them, and the rule says so.
 *
 * That is an honest negative and it is reported rather than tuned away. The rule becomes usable the
 * day layer 3 emits a per-game distribution, because the interval will then be about how good he is
 * rather than only about how often he plays, and the comparison will have some information in it.
 * Until then the board ships `decide/tiers.ts`' games-worth rule: a new tier where the next man gives
 * up a full game's worth of production, and no tier wider than two points a game.
 */
export function overlapTiers(values: readonly { readonly value: number; readonly outlook: ProjectionDistribution }[]): readonly number[] {
  if (values.length === 0) return [];
  const tiers = [0];
  let tier = 0;
  for (let index = 1; index < values.length; index += 1) {
    const above = values[index - 1]!;
    const below = values[index]!;
    const gap = above.value - below.value;
    const overlap = Math.max(0, Math.min(above.outlook.ceiling, below.outlook.ceiling) - Math.max(above.outlook.floor, below.outlook.floor));
    if (gap > overlap) tier += 1;
    tiers.push(tier);
  }
  return tiers;
}

function tierStandings(tiers: readonly number[], values: readonly number[]): readonly { playersLeftInTier: number; dropToNextTier: number }[] {
  return tiers.map((tier, index) => {
    const lastOfTier = tiers.lastIndexOf(tier);
    const firstOfNext = tiers.indexOf(tier + 1);
    return {
      playersLeftInTier: lastOfTier - index + 1,
      dropToNextTier: firstOfNext === -1 ? 0 : values[lastOfTier]! - values[firstOfNext]!,
    };
  });
}

/**
 * THE BOARD.
 *
 * `asOf` and `season` are carried rather than used, deliberately: this function reads no store and
 * makes no point-in-time decision. Everything it is handed was already gated by whoever built the
 * candidates, and a second gate here would be a second place for the two to disagree about what was
 * knowable — which is how a leak gets in wearing a defence's clothes.
 */
/** Whether a candidate carries a `"rookie"` reason — the same test `market/blend.ts`'s own
 *  `rookieReasonOf` runs, restated locally rather than imported: `market/` imports FROM
 *  `preseason/`, never the reverse. */
function isRookieCandidate(candidate: BoardCandidate): boolean {
  return candidate.reasons.some((reason) => reason.code === "rookie");
}

/** The per-game variance cell for one candidate — the class/position lookup `seasonPointsBand`
 *  needs, GAMES-ONLY (zero) for a position this round did not fit one for (K, DEF — never a
 *  rookie-curve position and never drafted onto this board at meaningful volume): that class's band
 *  claims only what it measures, exactly as availability-only banding always did for everyone before
 *  this round, rather than a borrowed number from a population it was never measured against. */
function gameVarianceFor(candidate: BoardCandidate, priors: GameVariancePriors): number {
  if (!(VARIANCE_POSITIONS as readonly Position[]).includes(candidate.position)) return 0;
  const position = candidate.position as VariancePosition;
  const playerClass: PlayerClass = isRookieCandidate(candidate) ? "rookie" : "veteran";
  // `?? 0` and NEVER a borrowed number: a cell no fit has measured is ABSENT from the priors
  // (`GameVariancePriors` is partial per position on purpose), and zero here is the games-only band
  // every position carried before the variance round rather than a claim about this one.
  return priors[playerClass][position] ?? 0;
}

export function preseasonBoard(
  candidates: readonly BoardCandidate[],
  { rules, shape, gameVariance = SHIPPED_GAME_VARIANCE }: PreseasonBoardOptions,
): readonly BoardEntry[] {
  const byPlayer = new Map<string, { candidate: BoardCandidate; seasonLine: StatLine; outlook: ProjectionDistribution }>();
  const projections: SeasonProjection[] = [];

  for (const candidate of candidates) {
    // The nonlinear component, already averaged over the candidate's own per-game distribution, in
    // points per game. Zero for every position but DEF — see `BoardCandidate.perGameTierPoints`.
    const tierPoints = candidate.perGameTierPoints ?? 0;
    const seasonLine = scaleStatLine(candidate.perGame, candidate.games.expected);
    const perGamePoints = computeFantasyPoints(candidate.perGame, candidate.position, rules) + tierPoints;
    const projectedPoints =
      computeFantasyPoints(seasonLine, candidate.position, rules) + tierPoints * candidate.games.expected;
    byPlayer.set(candidate.playerId, {
      candidate,
      seasonLine,
      // THREE SOURCES COMPOSED where all three are measured: per-game performance variance, the
      // games-played distribution, and (for the two positions the 2026-09-05 round fitted it) how
      // wrong the projection itself typically is. See `game-variance.ts`'s `seasonPointsInterval`
      // for the law-of-total-variance composition and for why the third term is not optional in
      // principle, and `overlapTiers` for what the resulting interval is honest about and silent on.
      outlook: seasonPointsInterval(
        perGamePoints,
        candidate.games,
        gameVarianceFor(candidate, gameVariance),
        Z90,
        candidate.seasonProjectionErrorVariance ?? 0,
      ),
    });
    projections.push({ playerId: candidate.playerId, position: candidate.position, projectedPoints });
  }

  // `valueBoard` returns its own order, which is by value over replacement. That order is the
  // DRAFT-VALUE VIEW and it is stamped here as `valueRank` before the board is re-sorted by points.
  const valued = valueBoard(projections, shape);
  const valueRanks = new Map(valued.map((player, index) => [player.playerId, index + 1] as const));

  // Tiers are per POSITION, and within a position value over replacement and points give the same
  // order because the subtraction is a constant, so a tier is the same object under either default.
  // Computed on value over replacement, which is the quantity `dropToNextTier` is reported in.
  //
  // The games-worth rule, consumed from `decide/tiers.ts` on PROJECTED POINTS (it is a share of the
  // man above, so it needs the scale). `overlapTiers` above implements the rule the spec actually
  // wrote down and returns one tier per position on both held-out seasons; see its docblock for
  // why, and the research document for the counts.
  const standings = new Map<string, { tier: number; playersLeftInTier: number; dropToNextTier: number }>();
  const positions = new Set(valued.map((player) => player.position));
  for (const position of positions) {
    const pool = valued.filter((player) => player.position === position);
    const values = pool.map((player) => player.valueOverReplacement);
    const tiers = tiersOf(pool.map((player) => player.projectedPoints));
    const withStandings = tierStandings(tiers, values);
    pool.forEach((player, index) => {
      standings.set(player.playerId, { tier: tiers[index]!, ...withStandings[index]! });
    });
  }

  const ordered = [...valued].sort(
    (a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId),
  );

  return ordered.map((player, index) => {
    const held = byPlayer.get(player.playerId)!;
    const standing = standings.get(player.playerId)!;
    const reasons: BoardReason[] = [
      ...held.candidate.reasons,
      {
        code: "scarcity",
        positionRank: player.positionRank,
        replacementLevel: player.replacementLevel,
      },
    ];
    if (standing.dropToNextTier > 0) {
      reasons.push({
        code: "tier_cliff",
        playersLeftInTier: standing.playersLeftInTier,
        dropToNextTier: standing.dropToNextTier,
      });
    }
    return {
      ...player,
      rank: index + 1,
      valueRank: valueRanks.get(player.playerId)!,
      team: held.candidate.team,
      expectedGames: held.candidate.games.expected,
      seasonLine: held.seasonLine,
      outlook: held.outlook,
      tier: standing.tier,
      playersLeftInTier: standing.playersLeftInTier,
      dropToNextTier: standing.dropToNextTier,
      reasons,
    };
  });
}

/**
 * THE DRAFT-VALUE VIEW: the same board, ordered by value over replacement.
 *
 * A labelled second reading rather than the default, and the label is the point. Ranking a
 * quarterback below a back because the twelfth quarterback is nearly as good as the first is a real
 * and useful statement about a DRAFT PICK, and it is the statement `decide/replacement.ts` exists to
 * make. It is not a statement about who will score more, and when it is scored as one it loses to
 * the plain points column on both held-out seasons and in almost every band.
 *
 * So both are computed from one board rather than two, which is the only way the comparison is like
 * for like, and the research document publishes both numbers side by side.
 */
export function byValueOverReplacement(board: readonly BoardEntry[]): readonly BoardEntry[] {
  return [...board].sort((a, b) => a.valueRank - b.valueRank);
}

