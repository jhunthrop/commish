import type { Law } from "@/projections/laws/types";
import type { BoardReason } from "@/projections/preseason/board";
import { lawHeadline, type LawReason } from "@/components/ui/reason-chip";

/**
 * THE GROUPED EVIDENCE VIEW-MODEL (founder, 2026-09-04, Outlook redesign) — the fix for "three
 * laws measuring the same quantity stammer ('84.8% snap share' three times with three different
 * effects)". `player.ts`'s `PlayerSeasonBody.reasons` is the board's own full reason chain, one
 * entry per law that fired PLUS the structural facts (`availability`, `scarcity`, ...); rendering
 * it flat, one `ReasonChip` per entry, is what produced the stammer — nothing upstream de-dupes a
 * quantity two confirmed laws both happen to condition on.
 *
 * ONE GROUP, ONE QUANTITY. Every "law" reason collapses into a group keyed by the quantity its own
 * headline states (`groupKeyFor`, below); every other reason code becomes its own singleton "fact"
 * group, with THREE CODES EXCLUDED ENTIRELY (`market_anchor`, `scarcity`, `tier_cliff`) because
 * they feed the Outlook's own verdict sentence instead (`./verdict.ts`) rather than appearing a
 * second time as a peer chip.
 */

/** Every `BoardReason` code this module never turns into a peer chip — they feed `./verdict.ts`'s
 *  own sentence instead. Kept as one set so the exclusion is stated once, not spread across the
 *  loop below and this module's own exported `FactReason` type. */
const VERDICT_ONLY_CODES: ReadonlySet<BoardReason["code"]> = new Set(["market_anchor", "scarcity", "tier_cliff"]);

/** Every non-law reason code that becomes its own singleton "fact" group — `BoardReason` minus
 *  `"law"` and minus the three verdict-only codes above: `availability`, `offseason_share_gained`,
 *  `offseason_share_lost`, `changed_team`, `new_play_caller`, `rookie`, `market_unlisted`. */
export type FactReason = Exclude<BoardReason, LawReason | Extract<BoardReason, { code: "market_anchor" | "scarcity" | "tier_cliff" }>>;

/** One quantity's worth of evidence: either every law reason that measures it, collapsed to one
 *  headline and one net effect, or a single non-law fact carried through unchanged. */
export type EvidenceGroup =
  | { readonly kind: "law"; readonly key: string; readonly headline: string; readonly netEffect: number; readonly members: readonly LawReason[] }
  | { readonly kind: "fact"; readonly key: string; readonly reason: FactReason };

/**
 * THE GROUPING KEY — reuses `reason-chip.tsx`'s OWN keying rather than a second vocabulary. A
 * TRIBAL law groups on its own `lawId` (the same key `LAW_HEADLINES` is keyed by; today's six
 * tribal laws each measure a distinct quantity, so this never merges two of them on one player,
 * but it is the correct key the day one does). A DISCOVERED law groups on its persisted
 * `primaryQuantityId` (`registry.ts`'s own field, the same one `discoveredHeadline` reads) — the
 * founder's own "snap share" example is two DIFFERENT discovered law ids sharing one
 * `primaryQuantityId`, which is exactly what this key collapses.
 */
function groupKeyFor(reason: LawReason, law: Law | undefined): string {
  if (law !== undefined && law.origin === "discovered" && law.primaryQuantityId !== null) return law.primaryQuantityId;
  return reason.lawId;
}

type LawGroup = Extract<EvidenceGroup, { kind: "law" }>;
type FactGroup = Extract<EvidenceGroup, { kind: "fact" }>;

/**
 * Every law reason sharing one quantity collapsed to one group (headline stated once, off any one
 * member — see `lawHeadline`'s own docblock for why every member shares an identical `magnitude`),
 * strongest `|netEffect|` first; every other reason its own singleton "fact" group, in the order
 * the board itself listed them, appended after every law group; `market_anchor`/`scarcity`/
 * `tier_cliff` dropped (they feed `./verdict.ts`).
 */
export function groupReasons(reasons: readonly BoardReason[], laws: readonly Law[]): readonly EvidenceGroup[] {
  const byId = new Map(laws.map((law) => [law.id, law] as const));
  const lawReasonsByKey = new Map<string, LawReason[]>();
  const factGroups: FactGroup[] = [];

  for (const reason of reasons) {
    if (reason.code === "law") {
      const key = groupKeyFor(reason, byId.get(reason.lawId));
      const bucket = lawReasonsByKey.get(key);
      if (bucket === undefined) lawReasonsByKey.set(key, [reason]);
      else bucket.push(reason);
      continue;
    }
    if (VERDICT_ONLY_CODES.has(reason.code)) continue;
    factGroups.push({ kind: "fact", key: reason.code, reason: reason as FactReason });
  }

  const lawGroups: LawGroup[] = [...lawReasonsByKey.entries()].map(([key, members]) => {
    const sortedMembers = [...members].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    const strongest = sortedMembers[0]!;
    const netEffect = members.reduce((sum, member) => sum + member.effect, 0);
    return { kind: "law", key, headline: lawHeadline(strongest.lawId, strongest.magnitude, byId.get(strongest.lawId)), netEffect, members: sortedMembers };
  });
  lawGroups.sort((a, b) => Math.abs(b.netEffect) - Math.abs(a.netEffect));

  return [...lawGroups, ...factGroups];
}
