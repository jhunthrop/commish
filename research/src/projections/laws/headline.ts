import type { Law, PrimaryQuantityUnit } from "./types";
import type { BoardReason } from "@research/projections/preseason/board";

/**
 * THE LAW HEADLINE VOCABULARY, in the research core because the capsule writer and the outlook
 * grouping say the same headline the board chip shows (the prep site carve-out, 2026-10-12). It
 * lived in `components/ui/reason-chip.tsx`; the chip now imports it from here, so there is still
 * exactly one place a law's headline is worded.
 */

/** The `"law"` branch of `BoardReason`, narrowed once and named — `strongestLawReasons`'s own
 *  return type, so a caller mapping over its result keeps `lawId`/`effect`/`magnitude` narrowed
 *  rather than widening back to the full union. */
export type LawReason = Extract<BoardReason, { code: "law" }>;

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
