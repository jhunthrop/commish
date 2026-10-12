import type { Law } from "@research/projections/laws/types";
import type { BoardReason } from "@research/projections/preseason/board";
import { lawHeadline, type LawReason } from "@research/projections/laws/headline";
import { signedPoints } from "@research/lib/number-format";

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
 * TRIBAL LAW → QUANTITY ID (fix round 1, HIGH — the founder's own screenshot case: `rb_age_curve`
 * and any confirmed discovered RB age law both measure "age", and keying a tribal reason on its
 * own `lawId` while a discovered one keys on `primaryQuantityId` split that one quantity into two
 * groups, which is the exact stammer this whole module exists to close, only committed a second
 * time between origins instead of between two discovered ids). Six entries, one per `LAW_SPECS` id
 * (`populations.ts`) — the same set `LAW_HEADLINES` is keyed by, and the same six facts
 * `board-reasons.ts`'s `magnitudeForLaw` reads.
 *
 * Uses the discovery template's OWN quantity id (`discovery/templates.ts`'s `QUANTITY_DEFS`)
 * wherever the fact a tribal law reads is the SAME fact a discovered quantity id already names:
 * `rb_workload_cliff` reads `facts.touches` → `"touches"`; `rb_age_curve` reads `facts.age` →
 * `"age"`; `target_share_persistence` reads the player's OWN `facts.targetShare` → `"targetShare"`;
 * `play_caller_fingerprint` reads `facts.incomingCoachPriorPassRateOverExpected`, a verbatim
 * quantity id match. A STABLE SYNTHETIC id, prefixed `tribal:` so it can never collide with a real
 * discovery quantity id, covers the two tribal quantities discovery's own vocabulary has no entry
 * for: `wr_target_competition` reads `facts.bestTeammateTargetShare` — his BEST TEAMMATE's share,
 * a different fact from `target_share_persistence`'s own (`board-reasons.ts`'s own docblock states
 * the distinction), so merging it with a discovered "targetShare" law would silently claim two
 * different people's shares are one quantity; `td_regression` reads a touchdown-share-over-
 * THRESHOLD ratio (a unitless multiple, `LAW_HEADLINES`'s own "1.5x touchdown share" — never the
 * raw percent a discovered law over `"touchdownPointsShare"` reports), so it gets its own key
 * rather than merging with that quantity's raw-percent laws.
 */
const TRIBAL_QUANTITY_ID: Readonly<Record<string, string>> = {
  rb_workload_cliff: "touches",
  rb_age_curve: "age",
  wr_target_competition: "tribal:bestTeammateTargetShare",
  target_share_persistence: "targetShare",
  td_regression: "tribal:touchdownPointsShareOverThreshold",
  play_caller_fingerprint: "incomingCoachPriorPassRateOverExpected",
};

/**
 * THE GROUPING KEY — one shared quantity vocabulary for BOTH origins, closing the HIGH finding
 * above. A tribal law (any `lawId` in `TRIBAL_QUANTITY_ID`) keys on its own quantity id from that
 * mapping, checked FIRST so it never falls through to the registry lookup below. A discovered law
 * keys on its persisted `primaryQuantityId` (`registry.ts`'s own field, the same one
 * `discoveredHeadline` reads) — the founder's own "snap share" example is two DIFFERENT discovered
 * law ids sharing one `primaryQuantityId`, which this key collapses exactly as before. Anything
 * else (a future tribal law not yet added to the mapping above, or a discovered id the registry no
 * longer carries) falls back to its own bare `lawId` — a singleton group, the same safe default
 * this function has always had for evidence it cannot otherwise place.
 */
function groupKeyFor(reason: LawReason, law: Law | undefined): string {
  const tribalQuantityId = TRIBAL_QUANTITY_ID[reason.lawId];
  if (tribalQuantityId !== undefined) return tribalQuantityId;
  if (law !== undefined && law.origin === "discovered" && law.primaryQuantityId !== null) return law.primaryQuantityId;
  return reason.lawId;
}

type LawGroup = Extract<EvidenceGroup, { kind: "law" }>;
type FactGroup = Extract<EvidenceGroup, { kind: "fact" }>;

/**
 * THE GROUP'S OWN HEADLINE SOURCE — a TRIBAL member, when the group has one, ALWAYS wins over a
 * discovered member, regardless of whose `|effect|` is larger: a tribal headline is this product's
 * own hand-curated, polished phrasing for that quantity ("Age 29 season"), and picking it by
 * strongest-effect alone would let the SAME group read as "Age 29 season" or the mechanically
 * built "age 29.00" depending on which law happened to measure a slightly bigger delta this round
 * — two honest numbers, but an inconsistent STATEMENT of the one quantity, which is exactly what
 * "the group headline must remain a single honest statement of the quantity" (fix round 1) rules
 * out. At most one tribal member can ever be in a group (the six tribal laws each own a distinct
 * key in `TRIBAL_QUANTITY_ID`), so "the" tribal member is unambiguous when one exists.
 */
function headlineSourceOf(sortedMembers: readonly LawReason[]): LawReason {
  const tribalMember = sortedMembers.find((member) => TRIBAL_QUANTITY_ID[member.lawId] !== undefined);
  return tribalMember ?? sortedMembers[0]!;
}

/**
 * Every law reason sharing one quantity collapsed to one group (headline stated once, off
 * `headlineSourceOf` — every member shares an identical `magnitude` regardless of origin, since a
 * magnitude is a fact about the PLAYER, not about which law reported it), strongest `|netEffect|`
 * first; every other reason its own singleton "fact" group, in the order the board itself listed
 * them, appended after every law group; `market_anchor`/`scarcity`/`tier_cliff` dropped (they feed
 * `./verdict.ts`).
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
    const headlineSource = headlineSourceOf(sortedMembers);
    const netEffect = members.reduce((sum, member) => sum + member.effect, 0);
    return { kind: "law", key, headline: lawHeadline(headlineSource.lawId, headlineSource.magnitude, byId.get(headlineSource.lawId)), netEffect, members: sortedMembers };
  });
  lawGroups.sort((a, b) => Math.abs(b.netEffect) - Math.abs(a.netEffect));

  return [...lawGroups, ...factGroups];
}

/**
 * ONE LAW GROUP'S OWN SENTENCE — "one voice product-wide" (Draft HQ phase 2, board persona fix
 * 3): the identical copy `outlook.tsx`'s `EvidenceGroupRow` renders for a law group's own badge,
 * extracted here so a second surface (the evidence board's why-drawer top line) can state the
 * SAME group the SAME way rather than growing its own phrasing. A bare "-1.8 pts, Age 29 season"
 * reads as one measured number; "together" makes an aggregate of two-or-more laws self-evident in
 * the copy itself rather than left for a reader to infer from a member count alone.
 */
export function lawGroupLabel(group: Extract<EvidenceGroup, { kind: "law" }>): string {
  const { headline, netEffect, members } = group;
  return members.length > 1
    ? `together ${signedPoints(netEffect)} pts, ${headline} · ${members.length} laws`
    : `${signedPoints(netEffect)} pts, ${headline}`;
}
