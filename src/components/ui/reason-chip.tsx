import type { BoardReason } from "@/projections/preseason/board";
import type { Law } from "@/projections/laws/types";
import { Badge } from "./badge";
import { signedPoints } from "./event-feed-row";

/**
 * ONE REASON, ONE CHIP — the board's own "why" made legible next to a player, everywhere a
 * surface already carries his `BoardReason[]` (Task 7's `boardReasons`). Every number on the
 * chip comes straight off the reason itself (law 7: never type a number into copy); this file's
 * only hand-written vocabulary is the short HEADLINE a law's own id maps to, and a headline never
 * carries a figure of its own — the figure is always the reason's `magnitude` or `effect`,
 * formatted here and nowhere invented.
 *
 * A "law" reason renders `{headline}: measured {signed effect} pts per game` — the pattern the
 * task itself specifies ("Age 29 season: measured -1.8 pts per game", "Crowded target room:
 * measured -0.8 pts per game") — and carries the law's own plain-words `claim`
 * (`registry`, looked up by `lawId`) as an `sr-only` elaboration, the same "visible headline,
 * spoken sentence" split `Stat`'s own `comparisonSentence` already uses for a comparison. Every
 * other `BoardReason` code renders its own short, structured sentence so a surface with room for
 * the FULL CHAIN (PlayerPeek's Outlook) never has to invent a second renderer for the reasons a
 * law didn't produce.
 */

/**
 * Per-law headline, keyed by `Law.id` — the one hand-written vocabulary this file carries. Each
 * function reads ONLY the reason's own `magnitude` (never a second number), in the unit
 * `laws/board-reasons.ts`'s `magnitudeForLaw` documents for that law id. `wr_target_competition`
 * and `play_caller_fingerprint` render a fixed qualitative headline rather than a raw share —
 * "crowded" and "new" already say what the number would, and the task's own worked example
 * ("Crowded target room: measured -0.8 pts per game") states this exact headline.
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

function lawHeadline(lawId: string, magnitude: number): string {
  const build = LAW_HEADLINES[lawId];
  return build === undefined ? fallbackHeadline(lawId) : build(magnitude);
}

/** A fraction as a signed whole-number percent: "+4%", "-12%". The same "sign is the
 *  colourblind channel" idiom `signedPoints` carries for points, kept local since nothing else
 *  in this product signs a percent yet. */
function signedPercent(fraction: number): string {
  const rounded = Math.round(fraction * 100);
  return `${rounded < 0 ? "-" : "+"}${Math.abs(rounded)}%`;
}

/** The structured copy for one reason, sentence case, no em-dash. */
function copyFor(reason: BoardReason): string {
  switch (reason.code) {
    case "law":
      return `${lawHeadline(reason.lawId, reason.magnitude)}: measured ${signedPoints(reason.effect)} pts per game`;
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
export function ReasonChip({ reason, registry, className = "" }: ReasonChipProps) {
  const law = reason.code === "law" ? registry.find((entry) => entry.id === reason.lawId) : undefined;
  return (
    <Badge tone="neutral" className={`max-w-full truncate ${className}`}>
      {copyFor(reason)}
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
