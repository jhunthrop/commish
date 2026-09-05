import { createHash } from "node:crypto";
import type { Position } from "@/domain/player";
import { groupReasons } from "@/league-room/outlook/groups";
import { verdictLine } from "@/league-room/outlook/verdict";
import { quartilesFromSeasonBand } from "@/projections/preseason/band-quartiles";
import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";

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
  | { readonly kind: "law"; readonly headline: string; readonly netEffectPoints: number; readonly lawCount: number }
  | { readonly kind: "offseason_share_gained"; readonly targetShareChange: number; readonly carryShareChange: number }
  | { readonly kind: "offseason_share_lost"; readonly targetShareChange: number; readonly carryShareChange: number }
  | { readonly kind: "changed_team"; readonly from: string; readonly to: string }
  | { readonly kind: "new_play_caller"; readonly team: string }
  | { readonly kind: "rookie"; readonly overallPick: number | null }
  | { readonly kind: "market_unlisted" };

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
   * stored: `quartilesFromSeasonBand` (`@/projections/preseason/band-quartiles`) is an exact
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
      items.push({ kind: "law", headline: group.headline, netEffectPoints: group.netEffect, lawCount: group.members.length });
      continue;
    }
    const reason = group.reason;
    switch (reason.code) {
      case "availability":
        continue;
      case "offseason_share_gained":
        items.push({ kind: "offseason_share_gained", targetShareChange: reason.targetShare, carryShareChange: reason.carryShare });
        continue;
      case "offseason_share_lost":
        items.push({ kind: "offseason_share_lost", targetShareChange: reason.targetShare, carryShareChange: reason.carryShare });
        continue;
      case "changed_team":
        items.push({ kind: "changed_team", from: reason.from, to: reason.to });
        continue;
      case "new_play_caller":
        items.push({ kind: "new_play_caller", team: reason.team });
        continue;
      case "rookie":
        items.push({ kind: "rookie", overallPick: reason.overallPick });
        continue;
      case "market_unlisted":
        items.push({ kind: "market_unlisted" });
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
  addName(facts.identity.name);
  addName(facts.identity.team);
  addName(facts.identity.position);
  for (const item of facts.evidence) {
    if (item.kind === "changed_team") {
      addName(item.from);
      addName(item.to);
    }
    if (item.kind === "new_play_caller") addName(item.team);
  }
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
