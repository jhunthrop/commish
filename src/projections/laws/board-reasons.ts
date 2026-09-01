import type { BoardReason } from "../preseason/board";
import { LAW_CONDITIONS, type LawConditionFacts } from "./populations";
import type { Law } from "./types";

/**
 * MAGNITUDE, PER LAW — the player's OWN value of the exact quantity his condition (`LAW_CONDITIONS`,
 * `populations.ts`) reads, so a "law" reason says not just "this law applies to him" but "by how
 * much." Every case here mirrors the matching `*Condition` predicate's own fields, so a magnitude can
 * never name a quantity its condition did not check:
 *
 *   - `rb_workload_cliff`: his own touches (carries + receptions), season N — the workload the
 *     cliff claim is about.
 *   - `rb_age_curve`: his own age at season N's opener.
 *   - `wr_target_competition`: his BEST teammate's own season-N target share — the competing claim
 *     on the room, not his own share.
 *   - `target_share_persistence`: his OWN season-N target share — the share the claim says persists.
 *   - `td_regression`: his season-N touchdown-points share divided by his position's season-N
 *     threshold for it (1.5x the position median, `populations.ts`'s `tdShareThresholds`) — how far
 *     over the regression line he sits, rather than the raw share alone, since the threshold itself
 *     moves by position and by season. A zero threshold (never seen in real data, possible in a
 *     fixture) falls back to the raw share rather than dividing by zero.
 *   - `play_caller_fingerprint`: the incoming play-caller's own prior pass-rate-over-expected. Not
 *     among today's confirmed laws, but a total mapping keeps `lawReasonsFor` from needing a special
 *     case the day the registry confirms a seventh law.
 *
 * Returns `null` for a law id this function has no case for, or when the specific fact its case
 * reads is itself unknown — the same tri-state discipline every `LawConditionFacts` field keeps.
 * `lawReasonsFor` treats either as "this law's condition passed but its magnitude cannot be read,"
 * which should never happen for a law whose condition it just confirmed true (every case above reads
 * the identical field(s) its condition predicate already required to be non-null) — see its own
 * docblock for why that combination throws rather than drops.
 */
export function magnitudeForLaw(lawId: string, facts: LawConditionFacts): number | null {
  switch (lawId) {
    case "rb_workload_cliff":
      return facts.touches;
    case "rb_age_curve":
      return facts.age;
    case "wr_target_competition":
      return facts.bestTeammateTargetShare;
    case "target_share_persistence":
      return facts.targetShare;
    case "td_regression": {
      const { touchdownPointsShare, touchdownPointsShareThreshold } = facts;
      if (touchdownPointsShare === null || touchdownPointsShareThreshold === null) return null;
      return touchdownPointsShareThreshold > 0 ? touchdownPointsShare / touchdownPointsShareThreshold : touchdownPointsShare;
    }
    case "play_caller_fingerprint":
      return facts.incomingCoachPriorPassRateOverExpected;
    default:
      return null;
  }
}

/**
 * THE ONE PLACE A CANDIDATE'S FACTS BECOME "law" BOARD REASONS — every CONFIRMED law (`registry.ts`:
 * only a confirmed law's evidence is strong enough to speak on the board) whose condition
 * (`LAW_CONDITIONS`, the EXACT predicate `populations.ts` measures the law's own effect with) is
 * TRUE for him, in `laws` order. A `weak` or `debunked` law, or a confirmed law whose condition is
 * `false` or unknown (`null` — no evidence, never treated as false), contributes nothing: this is a
 * filter over the registry's own verdicts, never a synthesis of a new one.
 *
 * `laws` is a parameter rather than a call to `registry()` inside here, so this stays the pure,
 * DB-free, disk-free core every caller — a live board via `laws/board-reasons.ts`'s only export, and
 * a future test with a hand-built registry fixture — can drive identically.
 *
 * ORIGIN-SCOPED (Task 7, 2026-08-31): `registry()` now merges `origin: "discovered"` laws in
 * alongside the six tribal ones (`registry.ts`'s own docblock). A discovered law's antecedent is a
 * `discovery/generate.ts` candidate's own `condition(DiscoveryFacts)` predicate, a completely
 * different fact shape than this function's `LawConditionFacts` — `LAW_CONDITIONS` was built from
 * `LAW_ENTRIES` (the six tribal laws) alone and was never meant to answer for a discovered law's id.
 * Wiring a discovered law's condition into a live board is Task 8's own concern (chip/deviation
 * eligibility for `confirmed` discovered laws); until then, a non-tribal law is skipped here exactly
 * like a `weak`/`debunked` one — silently contributing nothing, never a drift error, because it is
 * not drift: `LAW_CONDITIONS` was never supposed to cover it. A `confirmed` TRIBAL law missing from
 * `LAW_CONDITIONS` is still the real bug this throw exists to catch.
 */
export function lawReasonsFor(facts: LawConditionFacts, laws: readonly Law[]): readonly BoardReason[] {
  const reasons: BoardReason[] = [];
  for (const law of laws) {
    if (law.verdict !== "confirmed") continue;
    if (law.origin !== "tribal") continue;
    const condition = LAW_CONDITIONS.get(law.id);
    if (condition === undefined) {
      throw new Error(`lawReasonsFor: "${law.id}" has no condition predicate in LAW_CONDITIONS — a law and populations.ts have drifted.`);
    }
    if (condition(facts) !== true) continue;
    const magnitude = magnitudeForLaw(law.id, facts);
    if (magnitude === null) {
      throw new Error(
        `lawReasonsFor: "${law.id}"'s condition is true but magnitudeForLaw returned null — its magnitude case reads a fact its condition does not guarantee.`,
      );
    }
    reasons.push({ code: "law", lawId: law.id, effect: law.measured.effect, magnitude });
  }
  return reasons;
}
