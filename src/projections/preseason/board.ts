import { STAT_FIELDS, type Position, type StatLine } from "@/domain/player";
import { computeFantasyPoints, type ScoringRules } from "@/scoring/compute";
import type { ProjectionDistribution } from "../decide/outlook";
import { valueBoard, type LeagueShape, type SeasonProjection, type ValuedPlayer } from "../decide/replacement";
import { tiersOf } from "../decide/tiers";
import type { GamesPlayedOutlook } from "./availability";

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
   * board, so his season points are the raw model's own number rather than a market-anchored blend.
   * NOT a claim that the model is wrong about him — an unranked player is usually a deep camp body
   * neither a real draft board nor `blendBoard` has an opinion worth blending — only that the two
   * numbers a manager can compare on every other row (what the market thinks, what evidence moved
   * him off it) do not exist for this one.
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
  | { readonly code: "law"; readonly lawId: string; readonly effect: number; readonly magnitude: number };

/** One player as the board receives him: a per-game line, a games distribution, and his causes. */
export interface BoardCandidate {
  readonly playerId: string;
  readonly position: Position;
  readonly team: string;
  /** Layer 3's predicted line for ONE game. `week` on it is not read. */
  readonly perGame: StatLine;
  readonly games: GamesPlayedOutlook;
  /** Reasons discovered upstream, before scarcity and tiers are known. */
  readonly reasons: readonly BoardReason[];
}

export interface PreseasonBoardOptions {
  readonly season: number;
  /** The moment the board was taken. Carried for provenance; nothing here reads a store. */
  readonly asOf: Date;
  readonly rules: ScoringRules;
  readonly shape: LeagueShape;
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
  /** Season points at the tenth, fiftieth and ninetieth percentiles of his games distribution. */
  readonly outlook: ProjectionDistribution;
  /** 0-based tier within his position, from `decide/tiers.ts` gap rule. See `overlapTiers`. */
  readonly tier: number;
  readonly playersLeftInTier: number;
  readonly dropToNextTier: number;
  readonly reasons: readonly BoardReason[];
}

/** Every component multiplied by a number of games. Scoring is applied after, never before. */
export function scaleStatLine(line: StatLine, games: number): StatLine {
  if (!(games >= 0) || !Number.isFinite(games)) {
    throw new Error(`A season line is a per-game line times a finite number of games; got ${games}.`);
  }
  return {
    ...line,
    ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, line[field] * games])) as Omit<StatLine, "playerId" | "week">),
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
 * Until then the board ships `decide/tiers.ts`' gap rule, which compares a gap to the position's own
 * typical gap and is a stated comparison against a real population.
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
export function preseasonBoard(
  candidates: readonly BoardCandidate[],
  { rules, shape }: PreseasonBoardOptions,
): readonly BoardEntry[] {
  const byPlayer = new Map<string, { candidate: BoardCandidate; seasonLine: StatLine; outlook: ProjectionDistribution }>();
  const projections: SeasonProjection[] = [];

  for (const candidate of candidates) {
    const seasonLine = scaleStatLine(candidate.perGame, candidate.games.expected);
    const perGamePoints = computeFantasyPoints(candidate.perGame, candidate.position, rules);
    const projectedPoints = computeFantasyPoints(seasonLine, candidate.position, rules);
    byPlayer.set(candidate.playerId, {
      candidate,
      seasonLine,
      // The interval is the games distribution carried through the same multiplication. It is
      // honest about what it covers and silent about what it does not: see `overlapTiers`.
      outlook: {
        floor: perGamePoints * candidate.games.distribution.floor,
        median: perGamePoints * candidate.games.distribution.median,
        ceiling: perGamePoints * candidate.games.distribution.ceiling,
      },
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
  // The GAP rule, consumed from `decide/tiers.ts`. `overlapTiers` above implements the rule the spec
  // actually wrote down and returns one tier per position on both held-out seasons; see its docblock
  // for why, and the research document for the counts.
  const standings = new Map<string, { tier: number; playersLeftInTier: number; dropToNextTier: number }>();
  const positions = new Set(valued.map((player) => player.position));
  for (const position of positions) {
    const pool = valued.filter((player) => player.position === position);
    const values = pool.map((player) => player.valueOverReplacement);
    const tiers = tiersOf(values);
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

