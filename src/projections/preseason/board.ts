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
 * RANKED BY VALUE OVER REPLACEMENT, NEVER BY POINTS, and this is the difference between a board and
 * a list. `decide/replacement.ts` makes the argument in full; the short form is that a quarterback
 * who scores 330 and a back who scores 300 are not a thirty-point gap when the twelfth quarterback
 * scores 290 and the thirty-first back scores 150. Replacement level is CONSUMED from that module
 * and not re-derived, because it is a function of this league's team count and roster shape and
 * nothing here knows better than the league does.
 *
 * WHAT PHASE 5 LEARNED AND THIS BOARD OWES IT. `docs/research/2026-08-27-decision-quality.md` found
 * that drafting by highest value over replacement, with no roster need, is worse than a plain points
 * ranking every single time — a seat that takes the highest number available drafts seven tight
 * ends. That is an argument about a STRATEGY, not about a valuation, and the fix belongs where the
 * decision is made. What this board owes it is two things: the replacement level is computed over
 * the starters this league actually fields (flex slots included, which is what stops a position
 * from looking scarcer than it is), and both orderings are measured. If the value ranking scores
 * worse than the points ranking on held-out seasons, the research document says so and the board
 * ships as an explanation rather than as an instruction.
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
  | { readonly code: "tier_cliff"; readonly playersLeftInTier: number; readonly dropToNextTier: number };

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
  /** 1-based overall rank, by value over replacement. */
  readonly rank: number;
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

  const valued = valueBoard(projections, shape);

  // Tiers are per POSITION and computed on value over replacement, because that is what the board is
  // ordered by and a tier drawn on a different quantity than the ranking would put a cliff in the
  // middle of a run of adjacent players.
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

  return valued.map((player, index) => {
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
 * The same projections ordered by POINTS instead, which is what Phase 5 found beat a value ranking.
 *
 * Exported so the research document can score both from one board rather than building two, which
 * is the only way the comparison is like for like. Named as a benchmark rather than as a mode: it is
 * the thing the board has to beat, not an alternative the product offers.
 */
export function byProjectedPoints(board: readonly BoardEntry[]): readonly BoardEntry[] {
  return [...board].sort(
    (a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId),
  );
}

