import type { Law, PrimaryQuantityUnit } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { Badge } from "./badge";
import { signedPoints } from "./event-feed-row";
import { formatTenth } from "./number-format";

/**
 * ONE REASON, ONE CHIP — the board's own "why" made legible next to a player, everywhere a
 * surface already carries his `BoardReason[]` (Task 7's `boardReasons`). Every number on the
 * chip comes straight off the reason itself (law 7: never type a number into copy); a TRIBAL law's
 * headline is this file's own hand-written vocabulary (`LAW_HEADLINES`, six entries, one per
 * `LAW_SPECS` id), and a DISCOVERED law's headline is built mechanically instead
 * (`discoveredHeadline`, below) from the persisted `primaryQuantityNoun`/`primaryQuantityUnit`
 * fields already sitting on the `Law` record this component receives. Either way a headline never
 * carries a figure of its own — the figure is always the reason's `magnitude` or `effect`,
 * formatted here and nowhere invented.
 *
 * NO `discovery/*` IMPORT, ON PURPOSE (Task 8 fix round, 2026-08-31 — supersedes an earlier version
 * of this file that called `generateCandidates()` and `discovery/templates.ts`'s
 * `primaryQuantityDefOf` directly). This component is bundled into THREE separate "use client"
 * surfaces (`draft-board.tsx`, `player-pool.tsx`, `player-peek.tsx`); dragging the ~1,737-candidate
 * generator and its committed quantile table into all three for the sake of one headline string was
 * real, avoidable bundle weight. `discovery/measure.ts` now writes a discovered law's own
 * presentation data — `primaryQuantityId` (for `board-reasons.ts`'s own consistency guard, unused
 * here), `primaryQuantityNoun`, `primaryQuantityUnit` — onto `registry.ts`'s `Law` record ONCE, at
 * discovery time; this component reads those three fields off the `law` it already looks up for the
 * `sr-only` claim below, and needs nothing else. `board-reasons.ts` (a server-only module) keeps
 * importing `discovery/templates.ts` directly, which is fine — it never ships to the browser.
 *
 * A "law" reason renders `{headline}: {costs him|worth} {effect} pts a game` — the verb form the
 * dossier-voice round (§3.7) replaced the original "measured -1.8 pts per game" with, after the
 * founder read that phrasing as a bot's — and carries the law's own plain-words `claim`
 * (`registry`, looked up by `lawId`) as an `sr-only` elaboration, the same "visible headline,
 * spoken sentence" split `Stat`'s own `comparisonSentence` already uses for a comparison. Every
 * other `BoardReason` code renders its own short, structured sentence so a surface with room for
 * the FULL CHAIN (PlayerPeek's Outlook) never has to invent a second renderer for the reasons a
 * law didn't produce.
 */

/**
 * Per-TRIBAL-law headline, keyed by `Law.id` — the one HAND-WRITTEN vocabulary this file carries
 * (see `discoveredHeadline`, below, for the discovered half, which is mechanical instead). Each
 * function reads ONLY the reason's own `magnitude` (never a second number), in the unit
 * `laws/board-reasons.ts`'s `magnitudeForLaw` documents for that law id. `wr_target_competition`
 * and `play_caller_fingerprint` render a fixed qualitative headline rather than a raw share —
 * "crowded" and "new" already say what the number would, and the task's own worked example
 * ("Crowded target room: costs him 0.8 pts a game") states this exact headline.
 */
const LAW_HEADLINES: Readonly<Record<string, (magnitude: number) => string>> = {
  rb_workload_cliff: (magnitude) => `${Math.round(magnitude)} touches last season`,
  rb_age_curve: (magnitude) => `Age ${Math.round(magnitude)} season`,
  wr_target_competition: () => "Crowded target room",
  target_share_persistence: (magnitude) => `${Math.round(magnitude * 100)}% target share`,
  td_regression: (magnitude) => `${magnitude.toFixed(1)}x touchdown share`,
  play_caller_fingerprint: () => "New play caller",
};

/** A law id `LAW_HEADLINES` has no case for — a registry id renamed or added since this file was
 *  last touched. Never throws: this is a render path, not the registry's own drift guard. */
function fallbackHeadline(lawId: string): string {
  const words = lawId.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A discovered law's own MAGNITUDE (a player's actual value of the primary quantity), formatted with
 * PLAIN rounding — one of four mechanical shapes keyed by `PrimaryQuantityUnit` (`types.ts`), the
 * SAME taxonomy `discovery/templates.ts`'s `QuantityDef.magnitudeUnit` assigns each quantity at
 * discovery time. Deliberately NOT the ceiling rounding a discovered law's own THRESHOLD number uses
 * (`templates.ts`'s `formatValue`, `renderSignedClaim`'s "...is 129 or more"): a threshold is a
 * claim's own boundary, where understating it would misstate what the law says; a magnitude is a
 * fact about one player, where plain, least-surprising rounding reads best and a ceiling would make
 * every player's own number look larger than it actually is.
 */
function formatMagnitude(unit: PrimaryQuantityUnit, value: number): string {
  switch (unit) {
    case "whole":
      return `${Math.round(value)}`;
    case "one_decimal":
      return value.toFixed(1);
    case "two_decimal":
      return value.toFixed(2);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
  }
}

/**
 * WORD ORDER, keyed by `PrimaryQuantityUnit` — a GENERIC rule, never a per-law or per-quantity
 * special case. Every unit reads "{value} {noun}" ("182 carries and receptions", "23.5%
 * touchdown-points share") except `"two_decimal"`, which reads noun-first, "{noun} {value}" ("age
 * 27.72"): `templates.ts`'s `QUANTITY_DEFS` assigns `magnitudeUnit: "two_decimal"` to exactly one
 * quantity today, age, and "27.72 age" reads like a units label stapled after a number, where "age
 * 27.72" reads as a stated fact the way "age 29 season" (`LAW_HEADLINES.rb_age_curve`, this file's
 * own hand-written TRIBAL headline) already does. The rule is stated on the UNIT, not on the
 * quantity id or the noun string, so it generalises automatically to any future `"two_decimal"`
 * quantity without a new case here.
 */
function wordOrderFor(unit: PrimaryQuantityUnit): "value-first" | "noun-first" {
  return unit === "two_decimal" ? "noun-first" : "value-first";
}

/**
 * A DISCOVERED law's headline, MECHANICALLY built from its own `Law` record's persisted
 * `primaryQuantityNoun`/`primaryQuantityUnit` — never a hand entry, because a discovered id changes
 * between discovery rounds. `"{formatMagnitude(unit, magnitude)} {noun}"` for every unit except
 * `"two_decimal"`, which flips to `"{noun} {formatMagnitude(unit, magnitude)}"` (`wordOrderFor`,
 * above) — e.g. "182 carries and receptions", but "age 27.72". No em-dash, matching every other
 * user-facing string in this engine, because neither `formatMagnitude`'s output nor a persisted
 * `primaryQuantityNoun` ever contains one (`discovery/templates.ts`'s own `shortLabel`s are
 * hand-written prose fragments, none of which use one either).
 *
 * `undefined` when `law`'s presentation fields are `null` — a TRIBAL law passed here by mistake, or
 * (defensively) a discovered law whose fields somehow came back unset; `lawHeadline` falls back to
 * `fallbackHeadline` in that case, the same graceful degradation a renamed tribal law already gets.
 * This is a render path, not the registry's own drift guard — that guard lives in
 * `board-reasons.ts`'s `lawReasonsFor`, which asserts a discovered law's persisted
 * `primaryQuantityId` against the live template BEFORE this component ever sees the reason.
 */
/**
 * ONE NAMED EXCEPTION TO THE GENERIC RULE ABOVE (founder, 2026-09-04, Outlook redesign) — the
 * `"pointsPerGame"` quantity (`discovery/templates.ts`'s own `noun: "points per game that
 * season"`) is the one primary quantity whose noun is also the unit `copyFor`'s "law" case always
 * appends: `"{value} points per game: costs him {effect} pts a game"` says "per game" twice and
 * reads as the law re-stating its own effect back at the reader rather than a fact about the
 * player. Every other quantity's noun (a share, an age, a touch count, ...) is a DIFFERENT unit
 * from the effect it precedes, so the sentence states two distinct facts; this is the only one
 * where the two clauses measure the same thing in the same words. Rephrased to what the quantity
 * actually is — the player's own scoring rate the season before this one
 * (`templates.ts`'s own docblock: "season N's own points per game, as a CONDITION ... with the
 * outcome still read at season N+1") — rather than suppressed, because the number is still the
 * fact the law's condition is keyed on.
 */
const POINTS_PER_GAME_QUANTITY_ID = "pointsPerGame";

export function discoveredHeadline(magnitude: number, law: Law): string | undefined {
  if (law.primaryQuantityNoun === null || law.primaryQuantityUnit === null) return undefined;
  const value = formatMagnitude(law.primaryQuantityUnit, magnitude);
  if (law.primaryQuantityId === POINTS_PER_GAME_QUANTITY_ID) return `averaging ${value} a game last season`;
  return wordOrderFor(law.primaryQuantityUnit) === "noun-first" ? `${law.primaryQuantityNoun} ${value}` : `${value} ${law.primaryQuantityNoun}`;
}

/** The headline for ANY law reason — tribal (`LAW_HEADLINES`) or discovered
 *  (`discoveredHeadline`) — the one function `copyFor`'s own "law" case calls, and the one
 *  `league-room/outlook/groups.ts` reuses to headline a GROUP of law reasons sharing one quantity
 *  (Outlook redesign, 2026-09-04): a group's members always share an identical `magnitude` (it is
 *  a fact about the player, not about which law fired), so headlining the group from any one
 *  member is the same headline this function has always produced for that member alone. */
export function lawHeadline(lawId: string, magnitude: number, law: Law | undefined): string {
  const build = LAW_HEADLINES[lawId];
  if (build !== undefined) return build(magnitude);
  const discovered = law === undefined ? undefined : discoveredHeadline(magnitude, law);
  return discovered ?? fallbackHeadline(lawId);
}

/** A fraction as a signed whole-number percent: "+4%", "-12%". The same "sign is the
 *  colourblind channel" idiom `signedPoints` carries for points, kept local since nothing else
 *  in this product signs a percent yet. */
function signedPercent(fraction: number): string {
  const rounded = Math.round(fraction * 100);
  return `${rounded < 0 ? "-" : "+"}${Math.abs(rounded)}%`;
}

/** The structured copy for one reason, sentence case, no em-dash. `law` is only read by the "law"
 *  case (`lawHeadline`); every other reason code ignores it. */
function copyFor(reason: BoardReason, law: Law | undefined): string {
  switch (reason.code) {
    case "law":
      // Said as a verb, never as a signed number in the lab register (dossier-voice round §3.7):
      // "measured -1.8 pts per game" is the exact sentence the founder read as a bot's.
      return `${lawHeadline(reason.lawId, reason.magnitude, law)}: ${reason.effect < 0 ? "costs him" : "worth"} ${formatTenth(Math.abs(reason.effect))} pts a game`;
    case "availability":
      return `Expected ${Math.round(reason.expectedGames)} games, ${Math.round(reason.floorGames)} to ${Math.round(reason.ceilingGames)}`;
    case "offseason_share_gained":
      return `Offseason share gained: targets ${signedPercent(reason.targetShare)}, carries ${signedPercent(reason.carryShare)}`;
    case "offseason_share_lost":
      return `Offseason share lost: targets ${signedPercent(-reason.targetShare)}, carries ${signedPercent(-reason.carryShare)}`;
    case "changed_team":
      return `Changed team, ${reason.from} to ${reason.to}`;
    case "new_play_caller":
      return `New play caller at ${reason.team}`;
    case "rookie":
      return reason.overallPick === null ? "Rookie, undrafted" : `Rookie, pick ${reason.overallPick}`;
    case "scarcity":
      return `Position rank ${reason.positionRank}, replacement level ${reason.replacementLevel.toFixed(1)} pts per game`;
    case "tier_cliff":
      return `${reason.playersLeftInTier} left in tier, ${reason.dropToNextTier.toFixed(1)} pt drop to the next`;
    case "market_unlisted":
      return "No ADP";
    case "market_anchor":
      // What players drafted at his ADP slot have averaged, against our evidence. Never "the
      // market": fantasy words, not trading words (founder, 2026-09-07).
      return `ADP slot averages ${reason.marketPoints.toFixed(1)} pts, ${signedPoints(reason.delta)} from evidence`;
    // THE KICKER AND TEAM DEFENCE REASONS (the 2026-09-05 round). Both positions are composed from
    // components rather than from shares, so the copy names the components a reader can argue with
    // and never a number without its basis.
    case "kicker_no_history":
      return "No kicking record yet, so this uses his club's volume and the league's make rates";
    case "kicker_opportunity":
      return `${reason.fieldGoalAttemptsPerGame.toFixed(1)} field goal and ${reason.extraPointAttemptsPerGame.toFixed(1)} extra point tries a game, ${Math.round(reason.fieldGoalMakeRate * 100)}% made`;
    case "defense_no_history":
      return "No defensive record in the seasons this board reads, so this uses the league's own rates";
    case "defense_takeaways":
      return `${reason.sacksPerGame.toFixed(1)} sacks and ${reason.takeawaysPerGame.toFixed(1)} takeaways a game, ${signedPoints(reason.tierPointsPerGame)} pts from what it allows`;
    default: {
      // Exhaustiveness guard: a future `BoardReason` variant with no case above fails `tsc`
      // here rather than rendering silently wrong copy.
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export interface ReasonChipProps {
  readonly reason: BoardReason;
  /**
   * The law registry (`registry()`, read server-side — this component never calls it itself,
   * since `registry()` reads off disk and this file renders in the browser). Used only to look
   * up a "law" reason's own plain-words `claim` for the `sr-only` elaboration below; every other
   * reason code ignores it. A `lawId` the registry no longer carries (stale evidence, a renamed
   * law) degrades to the plain headline rather than throwing — this is a render path, not the
   * registry's own drift guard (`registry.ts` already throws where that guard belongs).
   */
  readonly registry: readonly Law[];
  /**
   * Effect-first, prose-last, for fixed-width cells (the draft board's sticker, founder
   * screenshot 2026-09-04): a full sentence in a 140px column truncates to a bare figure and
   * half a word ("94.4% snap s"), and two laws over the same quantity truncate to what LOOKS
   * like the same line twice. Compact renders the one fact that never truncates, the measured
   * effect ("+2.1 pts"), and moves the whole sentence to the screen-reader elaboration. Only a
   * "law" reason has an effect to lead with; every other code ignores this flag and renders its
   * full copy, which is fine because the one compact consumer only ever passes law reasons.
   */
  readonly compact?: boolean;
  readonly className?: string;
}

/**
 * One reason, one chip. `Badge`'s own `neutral` tone — a reason is a stated fact, not a verdict
 * or a live state, so it wears the same quiet border every other fact-chip in this product wears
 * (`SlotChip`, the pool's "Drafted" badge) rather than spending one of law 1's six colour
 * meanings on a magnitude nothing here has compared to a population.
 *
 * `max-w-full truncate`: a sticker column and a pool row are both fixed-width, and a chip that
 * cannot shrink would bleed into the neighbour rather than wrap — the same failure mode
 * `Badge`'s own `whitespace-nowrap` risks everywhere else it is dropped into a narrow cell. This
 * chip is always the one that yields.
 */
export function ReasonChip({ reason, registry, compact = false, className = "" }: ReasonChipProps) {
  const law = reason.code === "law" ? registry.find((entry) => entry.id === reason.lawId) : undefined;
  if (compact && reason.code === "law") {
    return (
      <Badge tone="neutral" className={`max-w-full truncate ${className}`}>
        {`${signedPoints(reason.effect)} pts`}
        <span className="sr-only">{` ${copyFor(reason, law)}${law === undefined ? "" : ` ${law.claim}`}`}</span>
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" className={`max-w-full truncate ${className}`}>
      {copyFor(reason, law)}
      {law === undefined ? null : <span className="sr-only">{` ${law.claim}`}</span>}
    </Badge>
  );
}

/** The `"law"` branch of `BoardReason`, narrowed once and named — `strongestLawReasons`'s own
 *  return type, so a caller mapping over its result keeps `lawId`/`effect`/`magnitude` narrowed
 *  rather than widening back to the full union. */
export type LawReason = Extract<BoardReason, { code: "law" }>;

/** Only the "law" reasons — the ones a chip's own strength (`effect`) can be compared by —
 *  sorted strongest |effect| first and capped at `max`. Every other `BoardReason` code carries no
 *  `effect` to rank by, and a compact row (the draft board's own sticker) shows only law chips
 *  for exactly that reason; a surface with room for the full chain (PlayerPeek's Outlook) renders
 *  every reason instead of calling this. */
export function strongestLawReasons(reasons: readonly BoardReason[], max = 2): readonly LawReason[] {
  return reasons
    .filter((reason): reason is LawReason => reason.code === "law")
    .slice()
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, max);
}
