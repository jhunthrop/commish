import { createHash } from "node:crypto";
import type { Position } from "@research-ts/domain/player";
import { teamNameForms } from "@research-ts/domain/nfl-team-names";
import { groupReasons } from "@research-ts/capsules/outlook/groups";
import { verdictLine } from "@research-ts/capsules/outlook/verdict";
import type { PropMarket } from "@research-ts/projections/odds/props-store";
import { quartilesFromSeasonBand } from "@research-ts/projections/preseason/band-quartiles";
import type { Law } from "@research-ts/projections/laws/types";
import type { BoardReason } from "@research-ts/projections/preseason/board";
import type { RankedStat } from "./rank";
import type { TrendMetric } from "./trend";
import { derivedNumbers, printedTextNumbers } from "./derived-numbers";
import { depthNames, depthNumbers, depthTeamCodes } from "./facts/ledger";
import { EMPTY_DEPTH, type PlayerFactsDepth } from "./facts/types";

export { EMPTY_DEPTH } from "./facts/types";
export type * from "./facts/types";

/**
 * THE PLAYER CAPSULE'S FACT SHEET (spec §9 AMENDED 2026-09-04, Task 1) — every number and name a
 * capsule may ever cite, computed here deterministically and NEVER by the model. This module is
 * pure: no I/O, no clock, no randomness. `src/capsules/collect.ts` is the only caller, and it does
 * every database read `PlayerFactsInput` needs before calling `buildPlayerFacts`.
 *
 * TWO AUDIENCES, ONE SOURCE. `PlayerFacts` itself is the VALIDATOR's own vocabulary (internal
 * field names, raw numbers) — `validate.ts` reads `numberLedger`/`nameLedger` off it directly.
 * `render.ts` is the SEPARATE, manager-language serialization the model actually reads (founder
 * ruling, 2026-09-04, after a live sample leaked "p10/p90"/"evidence projection" into fan-facing
 * prose because the model was handed this file's own internal vocabulary): it re-derives its own
 * sentences from these same structured numbers rather than echoing any string built here. Nothing
 * in this file is ever concatenated into a prompt.
 *
 * DETERMINISTIC ORDERING, EVERYWHERE. `evidence` keeps `groupReasons`' own order (strongest law
 * net effect first, then facts in the board's own order); `numberLedger`/`nameLedger` are built by
 * walking this object's OWN fields in one fixed order, never from a `Set`'s insertion-order
 * accident or an unordered DB read. Two calls with identical inputs always produce byte-identical
 * output, which is what makes `factsHash` a real cache key rather than a coin flip.
 */

/** One law group's net effect, or one non-law situational fact — mirrors `BoardReason` closely,
 *  but is its OWN type rather than a re-export: `availability` is deliberately absent (it is its
 *  own top-level `PlayerFacts` field, not a peer chip, matching the product's own Outlook split),
 *  and `market_anchor`/`scarcity`/`tier_cliff` never reach here at all (they feed `market`, below,
 *  the same "verdict-only" split `groups.ts` already draws). */
export type PlayerFactsEvidenceItem =
  | { readonly kind: "law"; readonly groupKey: string; readonly headline: string; readonly netEffectPoints: number; readonly lawCount: number }
  | { readonly kind: "offseason_share_gained"; readonly groupKey: string; readonly targetShareChange: number; readonly carryShareChange: number }
  | { readonly kind: "offseason_share_lost"; readonly groupKey: string; readonly targetShareChange: number; readonly carryShareChange: number }
  | { readonly kind: "changed_team"; readonly groupKey: string; readonly from: string; readonly to: string }
  | { readonly kind: "new_play_caller"; readonly groupKey: string; readonly team: string }
  | { readonly kind: "rookie"; readonly groupKey: string; readonly overallPick: number | null }
  | { readonly kind: "market_unlisted"; readonly groupKey: string };

export interface PlayerFactsAvailability {
  readonly expectedGames: number;
  readonly floorGames: number;
  readonly ceilingGames: number;
}

export interface PlayerFactsMarket {
  readonly adp: number | null;
  readonly positionAdp: string | null;
  /** The shipped board's own overall rank, by projected points — never recomputed per league. */
  readonly boardRank: number;
  /** From the board's own `"scarcity"` reason; `null` when the board never fired one for him. */
  readonly positionRank: number | null;
  readonly replacementLevel: number | null;
  /** From the board's own `"tier_cliff"` reason; `null` when there is no real cliff below him. */
  readonly playersLeftInTier: number | null;
  readonly dropToNextTier: number | null;
  /** From the board's own `"market_anchor"` reason: what the market itself is priced at, and the
   *  evidence's own season-point gap off that price. Both `null` when the board never anchored him
   *  to a market entry at all (an unlisted player — see `market_unlisted` on `evidence`). */
  readonly marketAnchorPoints: number | null;
  readonly marketAnchorDelta: number | null;
}

export interface PlayerFactsProjection {
  readonly projectedPoints: number;
  /** The honest p10 tail — an availability fact (injury seasons pool here), never a talent
   *  claim. `render.ts`/`write.ts` both frame it that way explicitly; see this field's own
   *  "band framing" note on `PlayerFacts`' docblock. */
  readonly floorPoints: number;
  readonly medianPoints: number;
  /** The honest p90 tail — smash seasons. */
  readonly ceilingPoints: number;
  /**
   * THE "MOST SEASONS" BAND (founder ruling, 2026-09-04: "the display convention product-wide is
   * the p25-p75 'most seasons' band leading, with the honest p10-p90 as the tails"). DERIVED, not
   * stored: `quartilesFromSeasonBand` (`@research-ts/projections/preseason/band-quartiles`) is an exact
   * function of `medianPoints`/`floorPoints`/`ceilingPoints` — the same three numbers already on
   * this object — so this is a different quantile of a distribution already in hand, never a new
   * fit or a new invented number. Falls back to the full `floorPoints`/`ceilingPoints` band
   * (never throws) on the rare stored row whose band does not bracket its own median.
   */
  readonly typicalLow: number;
  readonly typicalHigh: number;
}

export interface PlayerFactsSeasonTotals {
  readonly carries: number | null;
  readonly rushingYards: number;
  readonly targets: number | null;
  readonly receptions: number;
  readonly receivingYards: number;
  readonly passingYards: number;
  readonly touchdowns: number;
  readonly fantasyPoints: number;
}

export interface PlayerFactsSeasonSummary {
  readonly season: number;
  readonly gamesPlayed: number;
  readonly pointsPerGame: number;
  readonly totals: PlayerFactsSeasonTotals;
}

/**
 * THE COLOR FACTS (spec §9 AMENDED 2026-09-05, "an analyst breaking it down") — every one of these
 * comes from a store this product already holds; a store without the row means the field is
 * `null`/absent, never estimated. Four independent groups, matching the founder's own split:
 *
 *   (a) `PlayerFactsLastSeasonStory` — last season's story, computed from the SAME prior-season
 *       stat machinery `league-service/player.ts`'s `priorSeasonStats` already reads
 *       (`statLinesAsOfForLiveSurface`), but built ONCE for the whole board's population in
 *       `collect.ts` rather than per league request. Extended (color v2, Task 1) with an honest
 *       position rank, qualifier count and named neighbor for total points, touches and receiving
 *       yards.
 *   (b) the props line / Vegas win total pair, on `PlayerFacts.booksNumbers` — the sportsbooks' OWN
 *       numbers, phrased in `render.ts` as what the books "hang on him", never this engine's claim.
 *   (c) `PlayerFactsUsage` — last season's snap/target/red-zone shares, straight off the
 *       observation store's own usage quantities (`projections/laws/discovery-facts.ts`'s
 *       `DiscoveryQuantityValues`), independent of whether any law fired on them. Extended (color
 *       v2, Task 1) with the same rank/qualifier/neighbor triple as group (a), per share.
 *   (d) `PlayerFactsTrend` (color v2, Task 2) — year-over-year deltas from his own prior two
 *       seasons, serialized only when material against the position's own real spread. See
 *       `trend.ts`'s own docblock.
 */
/** One quantity's finish among his position's peers who played that season — see `rank.ts`'s own
 *  docblock for the ranking rule, the qualifier-count honesty guarantee, and the tie convention.
 *  Re-exported here under this file's own naming convention (every other type on `PlayerFacts` is
 *  named `PlayerFacts*`); `rank.ts` stays the single source of truth for the shape. */
export type PlayerFactsRankedStat = RankedStat;

export interface PlayerFactsLastSeasonStory {
  readonly season: number;
  /** His finish among his position's peers who played that season, by TOTAL points (never points
   *  per game) — "RB4 last season" is `pointsRank.positionRank: 4`. `value` is that season total,
   *  a NEW number on the ledger no earlier field carried (`pointsPerGame` below is the average,
   *  not the total). The qualifier: every peer at his position with at least one played week that
   *  season — the SAME population this field always ranked against, before this task added the
   *  count and the neighbor name to it. */
  readonly pointsRank: PlayerFactsRankedStat;
  readonly pointsPerGame: number;
  readonly gamesPlayed: number;
  /** His single best-scoring week that season. */
  readonly bestWeek: { readonly week: number; readonly points: number };
  /** How many of his own played weeks scored above the POSITION's pooled weekly median that
   *  season (every week played by every peer at his position, the same population
   *  `league-service/player.ts`'s `weekViews` judges a single week against) — the raw ingredient
   *  for a consistency read ("9 of 13 weeks above the position median"), `gamesPlayed` being the
   *  honest denominator. */
  readonly weeksAboveMedian: number;
  /** Season-total carries plus receptions, ranked among the SAME position's peers with a real
   *  (non-null) touches reading that season — see `collect.ts`'s own `lastSeasonStoriesFor`
   *  docblock for why this is sourced from `discoveryFactsForSeason`'s own participation-derived
   *  `touches` quantity rather than a `StatLine`'s own (nonexistent) `carries` field. `null` when
   *  the participation feed never placed him at all that season — no evidence, never a fabricated
   *  zero. */
  readonly touchesRank: PlayerFactsRankedStat | null;
  /** Season-total receiving yards, ranked the same way and against the same qualifier as
   *  `pointsRank`. */
  readonly receivingYardsRank: PlayerFactsRankedStat;
}

/** One sportsbook market's own median pre-kickoff line for this season — read through the same
 *  leakage-gated archive `projections/market/props-anchor.ts` anchors the board with
 *  (`medianPropLinesByPlayer`), never the blended season-points figure that function folds it
 *  into. `market` is the raw enum; `render.ts` alone turns it into English (`facts.ts`'s own
 *  two-audience docblock). */
export interface PlayerFactsPropsLine {
  readonly market: PropMarket;
  readonly medianLine: number;
}

/** The books' own numbers — see this module's own "color facts" docblock, group (b). */
export interface PlayerFactsBooksNumbers {
  /** Every market the archive actually captured for him pre-kickoff, in `PROP_MARKETS`' own
   *  fixed order (never DB row order) for `factsHash`'s determinism. Empty when the archive holds
   *  nothing for him. */
  readonly propsLines: readonly PlayerFactsPropsLine[];
  /** His CURRENT team's posted regular-season win total for the season being drafted
   *  (`team_week_observations`, source `vegas_win_totals`) — `null` when the archive holds no
   *  line for that team-season. */
  readonly teamVegasWinTotal: number | null;
}

/** Last season's usage, plain — see this module's own "color facts" docblock, group (c). Each
 *  share is `null` on the identical no-evidence rule `DiscoveryQuantityValues` itself keeps (the
 *  play-by-play never saw him, or the snap-count file never named him), never a fabricated zero. */
export interface PlayerFactsUsage {
  readonly season: number;
  readonly snapShare: number | null;
  /** Rank among the position's peers with a real (non-null) snap share that season — see
   *  `rank.ts`. `null` exactly when `snapShare` itself is `null`: there is nothing honest to rank
   *  a fact that does not exist. */
  readonly snapShareRank: PlayerFactsRankedStat | null;
  readonly targetShare: number | null;
  readonly targetShareRank: PlayerFactsRankedStat | null;
  /** Share of his OWN carries and targets that fell inside the twenty — see
   *  `DiscoveryQuantityValues.redZoneTouchShare`'s own docblock for the exact numerator/denominator. */
  readonly redZoneShare: number | null;
  readonly redZoneShareRank: PlayerFactsRankedStat | null;
}

/** One quantity's year-over-year read, from his own prior two seasons — see `trend.ts`'s own
 *  docblock for the materiality rule and the population it is measured against. Re-exported here
 *  under this file's own naming convention, the same pattern `PlayerFactsRankedStat` already
 *  follows for `rank.ts`. */
export type PlayerFactsTrendMetric = TrendMetric;

/** THE TREND (color v2, Task 2) — year-over-year deltas from his own prior two seasons, where BOTH
 *  exist (`collect.ts`'s own `null` handling: a rookie-adjacent player with only one prior season
 *  on record gets `PlayerFacts.trend: null` entirely, never a half comparison). Each field can
 *  still be independently `null` even when the object itself is not: a specific quantity can lack
 *  real evidence in one of the two seasons (the participation feed never placed him, say) even
 *  though his season TOTALS exist for both. */
export interface PlayerFactsTrend {
  readonly pointsPerGame: PlayerFactsTrendMetric | null;
  /** Yards per touch (carries plus receptions) for every position except WR/TE, which use yards
   *  per TARGET instead — a pure receiver's workload is better read against every ball thrown his
   *  way, drops and broken-up passes included, than against catches alone. See `collect.ts`'s own
   *  `opportunityDenominator`. */
  readonly yardsPerOpportunity: PlayerFactsTrendMetric | null;
  readonly targetShare: PlayerFactsTrendMetric | null;
}

/** THE THREE HONEST STATES an injury read can be in — see `PlayerFacts.injury`'s own docblock
 *  (fix round 1, CRITICAL 2) for why a nullable string could not tell two of them apart. */
export type PlayerFactsInjuryStatus =
  | { readonly state: "designated"; readonly designation: string; readonly asOf: string }
  | { readonly state: "clean"; readonly asOf: string }
  | { readonly state: "unknown" };

export interface PlayerFactsNewsItem {
  readonly title: string;
  readonly link: string;
  /** Read defensively off the harvested feed; `null` when the snapshot carries no date for this
   *  headline — never fabricated. See `collect.ts`'s own note on why this field is unverified. */
  readonly publishedAt: string | null;
}

/** Everything a capsule's writer and validator may ever read — see this module's own docblock. */
export interface PlayerFacts {
  readonly identity: { readonly id: string; readonly name: string; readonly position: Position; readonly team: string };
  /** The season this board projects — always present, even when `season` (played-week stats)
   *  below is `null` because the season has not kicked off yet. */
  readonly productSeason: number;
  readonly evidence: readonly PlayerFactsEvidenceItem[];
  readonly market: PlayerFactsMarket;
  readonly projection: PlayerFactsProjection;
  /** From the board's own `"availability"` reason; `null` when the board never fired one. */
  readonly availability: PlayerFactsAvailability | null;
  /** Played-week production, under this product's standard PPR scoring (the same fixed format
   *  the shipped board itself is composed under — see `draft-hq/board/service.ts`'s own
   *  docblock). `null` before he has a played week on record, which is the honest, common
   *  preseason state, never a fabricated zero. */
  readonly season: PlayerFactsSeasonSummary | null;
  readonly byeWeek: number | null;
  /**
   * A TRI-STATE, not a nullable string (fix round 1, CRITICAL 2). The prior shape (`string | null`
   * for the designation, paired with an `asOf` that was ALSO `null` whenever there was no
   * designation) rendered a genuinely clean read identically to "no injury feed has ever been
   * read at all" — a real, dangerous conflation: a player the sweep ran before any injury
   * snapshot existed would read exactly like a player a fresh snapshot just cleared. `"unknown"`
   * is now its own state, distinct from `"clean"` (a snapshot exists and does not name him — a
   * dated, honest "healthy as of X") and `"designated"` (a snapshot names him, with what and as
   * of when). `render.ts`/`template.ts` both read this directly and never say a bare "healthy"
   * sentence for `"unknown"`.
   */
  readonly injury: PlayerFactsInjuryStatus;
  /** Newest first, at most three — see `collect.ts`'s `newsForPlayers`. */
  readonly news: readonly PlayerFactsNewsItem[];
  /** LAST SEASON'S STORY (spec §9 AMENDED 2026-09-05) — `null` for a player the prior-season stat
   *  store carries nothing for (a rookie, most often), never a fabricated debut season. See this
   *  module's own "color facts" docblock, group (a). */
  readonly lastSeasonStory: PlayerFactsLastSeasonStory | null;
  /** The books' own numbers — see this module's own "color facts" docblock, group (b). */
  readonly booksNumbers: PlayerFactsBooksNumbers;
  /** Last season's usage, plain — `null` when the store carries no season for him at all (a
   *  rookie); a real season with individually-absent shares still returns non-null with some or
   *  all of its own fields `null` — see this module's own "color facts" docblock, group (c). */
  readonly usage: PlayerFactsUsage | null;
  /** THE TREND (color v2, Task 2) — `null` when the store carries no season two years before the
   *  product season for him at all (his own prior two seasons do not both exist). See
   *  `PlayerFactsTrend`'s own docblock. */
  readonly trend: PlayerFactsTrend | null;
  /** THE DEPTH FACTS (spec `2026-09-07-fact-sheet-depth-design.md`) — every verified fact this
   *  store holds that an expert would cite and the sections above did not carry: why a prior
   *  season ended, who is calling the plays, how the role moved inside a season, what the schedule
   *  and the market say. One group rather than fourteen fields, and `EMPTY_DEPTH` is the honest
   *  value for a player the depth stores hold nothing for. See `facts/types.ts`. */
  readonly depth: PlayerFactsDepth;
  /** Every number the validator will accept in a capsule's own prose, in this object's own
   *  declaration order. A fraction-valued fact (a share change) contributes BOTH its raw fraction
   *  and its whole-percent form, since prose almost always states the latter ("+4%") and the
   *  validator strips a trailing `%` before comparing rather than special-casing percentages. */
  readonly numberLedger: readonly number[];
  /** Every proper noun a capsule may name: the player's own full name and its individual words
   *  (so "Mahomes" alone still matches a ledger built from "Patrick Mahomes"), every team
   *  mentioned by any fact, and his position. */
  readonly nameLedger: readonly string[];
  /** SHA-256 of this object's own CONTENT fields (everything above `numberLedger`) — the cache
   *  key `collect.ts`/the sweep job compare against the stored row. Deliberately excludes the two
   *  ledgers: they are pure functions of the content fields, so hashing them too would be hashing
   *  the same information twice under a different name, never a source of a genuinely different
   *  hash. */
  readonly factsHash: string;
}

/** The raw ingredients `collect.ts` assembles from the database — see that module for the actual
 *  reads. Everything here is already a plain value; `buildPlayerFacts` does no I/O and no
 *  rounding beyond what copying a `BoardReason`'s own field requires. */
export interface PlayerFactsInput {
  readonly identity: { readonly id: string; readonly name: string; readonly position: Position; readonly team: string };
  readonly productSeason: number;
  readonly reasons: readonly BoardReason[];
  readonly laws: readonly Law[];
  readonly market: {
    readonly adp: number | null;
    readonly positionAdp: string | null;
    readonly boardRank: number;
  };
  /** The board's own stored band, raw — `typicalLow`/`typicalHigh` are DERIVED from these three
   *  inside `buildPlayerFacts`, never supplied by the caller (there is only one honest source for
   *  a quantile of this distribution). */
  readonly projection: { readonly projectedPoints: number; readonly floorPoints: number; readonly medianPoints: number; readonly ceilingPoints: number };
  readonly byeWeek: number | null;
  readonly season: PlayerFactsSeasonSummary | null;
  readonly injury: PlayerFactsInjuryStatus;
  readonly news: readonly PlayerFactsNewsItem[];
  /** Already fully computed by `collect.ts` — see that module's own docblock for where each of
   *  the three color-fact groups is read from. `buildPlayerFacts` copies these straight across,
   *  exactly as it already does for `season`/`byeWeek`. */
  readonly lastSeasonStory: PlayerFactsLastSeasonStory | null;
  readonly booksNumbers: PlayerFactsBooksNumbers;
  readonly usage: PlayerFactsUsage | null;
  readonly trend: PlayerFactsTrend | null;
  /** Already fully computed by `facts/collect-depth.ts` — copied straight across exactly as
   *  `usage`/`trend` are. OPTIONAL, and the omission means `EMPTY_DEPTH`: a caller with no depth
   *  reads (a fixture, a surface that never ran the depth collector) is stating "nothing was
   *  found", which is the identical honest value the collector itself yields for a player the
   *  depth stores hold no row for. There is no third state to tell apart, so there is no reason to
   *  make every existing caller spell out an empty object. */
  readonly depth?: PlayerFactsDepth;
}

function findReason<T extends BoardReason["code"]>(reasons: readonly BoardReason[], code: T): Extract<BoardReason, { code: T }> | undefined {
  return reasons.find((reason): reason is Extract<BoardReason, { code: T }> => reason.code === code);
}

function availabilityFrom(reasons: readonly BoardReason[]): PlayerFactsAvailability | null {
  const reason = findReason(reasons, "availability");
  if (reason === undefined) return null;
  return { expectedGames: reason.expectedGames, floorGames: reason.floorGames, ceilingGames: reason.ceilingGames };
}

function marketFrom(reasons: readonly BoardReason[], input: PlayerFactsInput["market"], boardRank: number): PlayerFactsMarket {
  const scarcity = findReason(reasons, "scarcity");
  const tierCliff = findReason(reasons, "tier_cliff");
  const marketAnchor = findReason(reasons, "market_anchor");
  return {
    adp: input.adp,
    positionAdp: input.positionAdp,
    boardRank,
    positionRank: scarcity?.positionRank ?? null,
    replacementLevel: scarcity?.replacementLevel ?? null,
    playersLeftInTier: tierCliff?.playersLeftInTier ?? null,
    dropToNextTier: tierCliff?.dropToNextTier ?? null,
    marketAnchorPoints: marketAnchor?.marketPoints ?? null,
    marketAnchorDelta: marketAnchor?.delta ?? null,
  };
}

/** The stored band plus its derived "most seasons" quartiles — see `PlayerFactsProjection
 *  .typicalLow`'s own docblock. Never throws: a stored band that fails to bracket its own median
 *  (corrupt data, not a display question) collapses the "most seasons" band to the full tails
 *  rather than taking the whole facts sheet down with it. */
function projectionFrom(raw: PlayerFactsInput["projection"]): PlayerFactsProjection {
  try {
    const { p25, p75 } = quartilesFromSeasonBand(raw.medianPoints, raw.floorPoints, raw.ceilingPoints);
    return { ...raw, typicalLow: p25, typicalHigh: p75 };
  } catch {
    return { ...raw, typicalLow: raw.floorPoints, typicalHigh: raw.ceilingPoints };
  }
}

/** `groupReasons`' own grouped view, translated into `PlayerFactsEvidenceItem`s. `availability`
 *  is dropped here (it is `PlayerFacts.availability`, not a peer item — see this module's own
 *  docblock); every other `FactReason` code maps straight across. Order is `groupReasons`' own:
 *  law groups by strongest net effect, then facts in the board's own order — never re-sorted. */
function evidenceFrom(reasons: readonly BoardReason[], laws: readonly Law[]): readonly PlayerFactsEvidenceItem[] {
  const groups = groupReasons(reasons, laws);
  const items: PlayerFactsEvidenceItem[] = [];
  for (const group of groups) {
    if (group.kind === "law") {
      items.push({ kind: "law", groupKey: group.key, headline: group.headline, netEffectPoints: group.netEffect, lawCount: group.members.length });
      continue;
    }
    const reason = group.reason;
    switch (reason.code) {
      case "availability":
        continue;
      case "offseason_share_gained":
        items.push({ kind: "offseason_share_gained", groupKey: group.key, targetShareChange: reason.targetShare, carryShareChange: reason.carryShare });
        continue;
      case "offseason_share_lost":
        items.push({ kind: "offseason_share_lost", groupKey: group.key, targetShareChange: reason.targetShare, carryShareChange: reason.carryShare });
        continue;
      case "changed_team":
        items.push({ kind: "changed_team", groupKey: group.key, from: reason.from, to: reason.to });
        continue;
      case "new_play_caller":
        items.push({ kind: "new_play_caller", groupKey: group.key, team: reason.team });
        continue;
      case "rookie":
        items.push({ kind: "rookie", groupKey: group.key, overallPick: reason.overallPick });
        continue;
      case "market_unlisted":
        items.push({ kind: "market_unlisted", groupKey: group.key });
        continue;
      /**
       * THE KICKER AND TEAM DEFENCE REASONS, DELIBERATELY UNTRANSLATED (the 2026-09-05 round). A
       * capsule is only ever built for a skill player — `collect.ts` gates on `isSkillPosition`
       * and that gate stays, per the spec's own non-goals — so these four can never actually
       * reach this function. They are named rather than swept into the default so the
       * exhaustiveness guard below keeps working for a reason code that IS meant to become a
       * fact, and so this file records the decision instead of leaving the next reader to
       * rediscover it. The written analysis a kicker deserves is a later round's question.
       */
      case "kicker_no_history":
      case "kicker_opportunity":
      case "defense_no_history":
      case "defense_takeaways":
        continue;
      /**
       * THE ROSTER STATUS, DELIBERATELY NOT AN EVIDENCE ITEM (the roster-status gate, 2026-09-08).
       * It is a dated observation about his availability, not a piece of the case for his
       * number, and `availability` is already this sheet's own top-level field rather than a peer
       * chip. Carrying the status into the sheet means teaching the writer's prompt a new fact
       * (`prompt.ts`, out of this round's scope), so it stays out here and the product surfaces
       * read it straight off the board's own reason instead (`roster-status-copy.ts`).
       */
      case "roster_status":
        continue;
      default: {
        // Exhaustiveness guard: a future `FactReason` variant with no case above fails `tsc`.
        const exhaustive: never = reason;
        return exhaustive;
      }
    }
  }
  return items;
}

/** Every number `evidenceFrom`'s own items carry, in item order — the evidence half of
 *  `numberLedger`. A share-change fact contributes both its raw fraction and its whole-percent
 *  rounding (see `PlayerFacts.numberLedger`'s own docblock). */
function evidenceNumbers(evidence: readonly PlayerFactsEvidenceItem[]): readonly number[] {
  const numbers: number[] = [];
  for (const item of evidence) {
    switch (item.kind) {
      case "law":
        numbers.push(item.netEffectPoints, item.lawCount);
        break;
      case "offseason_share_gained":
      case "offseason_share_lost":
        numbers.push(item.targetShareChange, item.targetShareChange * 100, item.carryShareChange, item.carryShareChange * 100);
        break;
      case "rookie":
        if (item.overallPick !== null) numbers.push(item.overallPick);
        break;
      case "changed_team":
      case "new_play_caller":
      case "market_unlisted":
        break;
    }
  }
  return numbers;
}

/** Every number one `PlayerFactsRankedStat` carries — its own value, its rank, and the honest
 *  qualifier count behind that rank (color v2, Task 1). The named neighbor is a NAME, not a
 *  number, so it belongs to `buildNameLedger` instead. */
function rankedStatNumbers(rank: PlayerFactsRankedStat): readonly number[] {
  return [rank.value, rank.positionRank, rank.qualifierCount];
}

/** Every number one `PlayerFactsTrendMetric` carries (color v2, Task 2) — both raw season values
 *  and the delta between them, whether or not that delta turned out material. A share-valued
 *  metric (`targetShare`) also contributes its whole-percent form, the same rule every other
 *  fraction on this ledger already follows. */
function trendMetricNumbers(metric: PlayerFactsTrendMetric, isShare: boolean): readonly number[] {
  // THE TWO SEASON YEARS (capsule acceptance round, 2026-09-07): `render.ts` prints them
  // ("18.1 a game in 2024 fell to 14.3 in 2025"), so a capsule saying "back in 2024" is quoting
  // the sheet, not inventing a year. A year the sheet never showed still fails, as it must.
  const numbers = [metric.priorSeason, metric.recentSeason, metric.priorValue, metric.recentValue, metric.delta];
  return isShare ? [...numbers, metric.priorValue * 100, metric.recentValue * 100, metric.delta * 100] : numbers;
}

/** The trend's own share of the number ledger — see `PlayerFactsTrend`'s own docblock for why
 *  each of the three fields can be independently absent even when the object itself is not. */
function trendNumbers(trend: PlayerFactsTrend | null): readonly number[] {
  if (trend === null) return [];
  const numbers: number[] = [];
  if (trend.pointsPerGame !== null) numbers.push(...trendMetricNumbers(trend.pointsPerGame, false));
  if (trend.yardsPerOpportunity !== null) numbers.push(...trendMetricNumbers(trend.yardsPerOpportunity, false));
  if (trend.targetShare !== null) numbers.push(...trendMetricNumbers(trend.targetShare, true));
  return numbers;
}

function colorNumbers(lastSeasonStory: PlayerFactsLastSeasonStory | null, booksNumbers: PlayerFactsBooksNumbers, usage: PlayerFactsUsage | null, trend: PlayerFactsTrend | null): readonly number[] {
  const numbers: number[] = [];
  if (lastSeasonStory !== null) {
    numbers.push(
      lastSeasonStory.season,
      ...rankedStatNumbers(lastSeasonStory.pointsRank),
      lastSeasonStory.pointsPerGame,
      lastSeasonStory.gamesPlayed,
      lastSeasonStory.bestWeek.week,
      lastSeasonStory.bestWeek.points,
      lastSeasonStory.weeksAboveMedian,
      ...rankedStatNumbers(lastSeasonStory.receivingYardsRank),
    );
    if (lastSeasonStory.touchesRank !== null) numbers.push(...rankedStatNumbers(lastSeasonStory.touchesRank));
  }
  for (const line of booksNumbers.propsLines) numbers.push(line.medianLine);
  if (booksNumbers.teamVegasWinTotal !== null) numbers.push(booksNumbers.teamVegasWinTotal);
  if (usage !== null) {
    numbers.push(usage.season);
    if (usage.snapShare !== null) numbers.push(usage.snapShare, usage.snapShare * 100);
    if (usage.snapShareRank !== null) numbers.push(...rankedStatNumbers(usage.snapShareRank));
    if (usage.targetShare !== null) numbers.push(usage.targetShare, usage.targetShare * 100);
    if (usage.targetShareRank !== null) numbers.push(...rankedStatNumbers(usage.targetShareRank));
    if (usage.redZoneShare !== null) numbers.push(usage.redZoneShare, usage.redZoneShare * 100);
    if (usage.redZoneShareRank !== null) numbers.push(...rankedStatNumbers(usage.redZoneShareRank));
  }
  numbers.push(...trendNumbers(trend));
  return numbers;
}

function buildNumberLedger(facts: Omit<PlayerFacts, "numberLedger" | "nameLedger" | "factsHash">): readonly number[] {
  const numbers: number[] = [facts.productSeason];
  const { market, projection, availability, season, byeWeek } = facts;
  numbers.push(market.boardRank);
  if (market.adp !== null) numbers.push(market.adp);
  if (market.positionRank !== null) numbers.push(market.positionRank);
  if (market.replacementLevel !== null) numbers.push(market.replacementLevel);
  if (market.playersLeftInTier !== null) numbers.push(market.playersLeftInTier);
  if (market.dropToNextTier !== null) numbers.push(market.dropToNextTier);
  if (market.marketAnchorPoints !== null) numbers.push(market.marketAnchorPoints);
  if (market.marketAnchorDelta !== null) numbers.push(market.marketAnchorDelta);
  numbers.push(projection.projectedPoints, projection.floorPoints, projection.medianPoints, projection.ceilingPoints, projection.typicalLow, projection.typicalHigh);
  if (availability !== null) numbers.push(availability.expectedGames, availability.floorGames, availability.ceilingGames);
  numbers.push(...evidenceNumbers(facts.evidence));
  if (season !== null) {
    numbers.push(season.season, season.gamesPlayed, season.pointsPerGame);
    const t = season.totals;
    if (t.carries !== null) numbers.push(t.carries);
    numbers.push(t.rushingYards);
    if (t.targets !== null) numbers.push(t.targets);
    numbers.push(t.receptions, t.receivingYards, t.passingYards, t.touchdowns, t.fantasyPoints);
  }
  if (byeWeek !== null) numbers.push(byeWeek);
  numbers.push(...colorNumbers(facts.lastSeasonStory, facts.booksNumbers, facts.usage, facts.trend));
  numbers.push(...depthNumbers(facts.depth));
  numbers.push(...derivedNumbers(facts), ...printedTextNumbers(facts));
  return numbers;
}

function buildNameLedger(facts: Omit<PlayerFacts, "numberLedger" | "nameLedger" | "factsHash">): readonly string[] {
  const names = new Set<string>();
  const addName = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    names.add(trimmed);
    for (const word of trimmed.split(/\s+/)) if (word.length > 1) names.add(word);
  };
  // EVERY SPELLING OF A TEAM (capsule acceptance round, 2026-09-07) — the ledger carried the
  // stored CODE alone, so a writer told a player plays for NYG and then writing "New York" failed
  // grounding for naming the team it had just been given. `teamNameForms` adds the city, the
  // nickname and the two together; an unknown code still grounds only itself.
  const addTeam = (code: string) => {
    for (const form of teamNameForms(code)) addName(form);
  };
  addName(facts.identity.name);
  addTeam(facts.identity.team);
  addName(facts.identity.position);
  for (const item of facts.evidence) {
    if (item.kind === "changed_team") {
      addTeam(item.from);
      addTeam(item.to);
    }
    if (item.kind === "new_play_caller") addTeam(item.team);
  }
  // NAMED NEIGHBORS (color v2, Task 1) — a top-three finish names the peer one rank better than
  // him, and that name must be groundable exactly like any other proper noun the model may cite.
  // `addName` also decomposes it into its own individual words, the same shorthand rule this
  // ledger already gives the subject's own name.
  const addRankedStatNeighbor = (rank: PlayerFactsRankedStat | null) => {
    if (rank !== null && rank.namedNeighbor !== null) addName(rank.namedNeighbor);
  };
  if (facts.lastSeasonStory !== null) {
    addRankedStatNeighbor(facts.lastSeasonStory.pointsRank);
    addRankedStatNeighbor(facts.lastSeasonStory.touchesRank);
    addRankedStatNeighbor(facts.lastSeasonStory.receivingYardsRank);
  }
  if (facts.usage !== null) {
    addRankedStatNeighbor(facts.usage.snapShareRank);
    addRankedStatNeighbor(facts.usage.targetShareRank);
    addRankedStatNeighbor(facts.usage.redZoneShareRank);
  }
  // THE DEPTH GROUP'S OWN NAMES — coaches, the men listed around him on the depth chart, his
  // team's target leaders. Team codes come back separately so they get the same city/nickname
  // expansion every other team on this ledger already gets, and a PERSON never does.
  for (const name of depthNames(facts.depth)) addName(name);
  for (const code of depthTeamCodes(facts.depth)) addTeam(code);
  return [...names];
}

/** SHA-256 over this object's own content fields, in one fixed declared order — the same
 *  "canonical object, `JSON.stringify`, hash" shape `draft-service/sim/store.ts`'s `configHash`
 *  already uses. */
function computeFactsHash(content: Omit<PlayerFacts, "numberLedger" | "nameLedger" | "factsHash">): string {
  const canonical = {
    identity: content.identity,
    productSeason: content.productSeason,
    evidence: content.evidence,
    market: content.market,
    projection: content.projection,
    availability: content.availability,
    season: content.season,
    byeWeek: content.byeWeek,
    injury: content.injury,
    news: content.news,
    lastSeasonStory: content.lastSeasonStory,
    booksNumbers: content.booksNumbers,
    usage: content.usage,
    trend: content.trend,
    depth: content.depth,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** THE ONE PLACE A CAPSULE'S FACTS ARE ASSEMBLED — pure, deterministic, and the only function
 *  `write.ts`/`validate.ts`/`template.ts` ever take a `PlayerFacts` from. See this module's own
 *  docblock for the two-audience split and the ordering guarantee. */
export function buildPlayerFacts(input: PlayerFactsInput): PlayerFacts {
  const evidence = evidenceFrom(input.reasons, input.laws);
  const content: Omit<PlayerFacts, "numberLedger" | "nameLedger" | "factsHash"> = {
    identity: input.identity,
    productSeason: input.productSeason,
    evidence,
    market: marketFrom(input.reasons, input.market, input.market.boardRank),
    projection: projectionFrom(input.projection),
    availability: availabilityFrom(input.reasons),
    season: input.season,
    byeWeek: input.byeWeek,
    injury: input.injury,
    news: input.news,
    lastSeasonStory: input.lastSeasonStory,
    booksNumbers: input.booksNumbers,
    usage: input.usage,
    trend: input.trend,
    depth: input.depth ?? EMPTY_DEPTH,
  };
  return {
    ...content,
    numberLedger: buildNumberLedger(content),
    nameLedger: buildNameLedger(content),
    factsHash: computeFactsHash(content),
  };
}

/** Exposed for `outlook.tsx`'s own capsule slot, which still wants the UI's OWN verdict sentence
 *  beside the capsule (the capsule augments the Outlook, it does not replace the verdict line —
 *  spec's own "the capsule joins these surfaces, it does not replace them"). Never fed to the
 *  model — see this module's own docblock. */
export function verdictSentenceFor(facts: Pick<PlayerFacts, "market" | "identity">, reasons: readonly BoardReason[]): string | null {
  return verdictLine(reasons, facts.identity.position);
}
