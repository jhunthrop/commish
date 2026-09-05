/**
 * ONE PLAIN SENTENCE PER `PickReason` VARIANT — extracted from `drawer-assistant-tab.tsx` (Task
 * 12) for the identical reason `odds-phrase.ts`'s own docblock already gives for pulling
 * `oddsPhrase` out of that same component: a pure sentence formatter belongs beside `reads.ts`/
 * `roster-fit.ts`, not inside a "use client" component, which would otherwise force every other
 * caller of the identical PRODUCT VOICE to either depend on React or duplicate the switch.
 * `drawer-assistant-tab.tsx` re-exports this for its own existing import sites and tests; the
 * Assistant demo (`@/draft-hq/assistant-demo/demo.tsx`) imports it directly, so the live room
 * and its replayed demo say the exact same words for the exact same reason, never a second,
 * driftable copy of this switch.
 *
 * Numbers straight off the reason's own fields, never a fresh estimate. Exhaustive over the
 * union with no `default`, so a new reason code fails to compile here rather than rendering
 * silently as nothing.
 */
import type { PickReason } from "@/projections/decide/draft";
import { oddsPhrase } from "./odds-phrase";

export function reasonSentence(reason: PickReason): string {
  switch (reason.code) {
    case "value_over_replacement":
      return `He ranks No. ${reason.positionRank} at ${reason.position}, ${reason.valueOverReplacement.toFixed(1)} points over replacement.`;
    case "will_not_survive":
      return `He probably will not last. ${oddsPhrase(reason.survivalProbability)} he is still there at pick ${reason.nextPick}.`;
    case "safe_to_wait":
      return `He can wait. ${oddsPhrase(reason.survivalProbability)} he is still there at pick ${reason.nextPick}.`;
    case "no_further_turn":
      return `Pick ${reason.pickNumber} is your last turn of the draft. There is no next pick to wait for.`;
    case "tier_cliff":
      return `Only ${reason.playersLeftInTier} ${reason.position} left in this tier. The price drops ${reason.dropToNextTier.toFixed(1)} points after that.`;
    case "fills_starting_slot":
      return `He fills your starting ${reason.slot} slot.`;
    case "roster_saturated":
      return `You already roster ${reason.alreadyRostered} ${reason.position} and bench ${reason.alreadyBenched} more. He adds depth only.`;
  }
}
