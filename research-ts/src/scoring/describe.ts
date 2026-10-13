import { HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING, TE_PREMIUM_SCORING } from "@research-ts/domain/scoring";
import type { ScoringRules } from "./compute";

/**
 * Every field `describeScoring` checks, matched exactly. `scoring_settings` stores fifteen
 * weights and no preset name, so a label naming a preset is only honest when EVERY weight
 * still agrees with that preset — a single edited field (a commissioner turning off PPR
 * receptions, say) makes a league something the shipped presets don't name.
 */
function sameWeights(a: ScoringRules, b: ScoringRules): boolean {
  return (Object.keys(b) as (keyof ScoringRules)[]).every((key) => a[key] === b[key]);
}

/**
 * The shipped presets, in the order a label is tried. Order does not affect the result — each
 * preset's weights are mutually exclusive by construction (`SCORING_PRESETS` in
 * `@research-ts/domain/scoring`) — but TE premium sits first because it is PPR plus one more field, and
 * checking the more specific shape first reads clearer than relying on that exclusivity.
 */
const PRESET_LABELS: readonly (readonly [ScoringRules, string])[] = [
  [TE_PREMIUM_SCORING, "PPR, TE premium"],
  [PPR_SCORING, "PPR"],
  [HALF_PPR_SCORING, "Half PPR"],
  [STANDARD_SCORING, "Standard"],
];

/**
 * Pure. Names a league's scoring from its weights alone, because that is all `scoring_settings`
 * stores. A league whose commissioner edited even one weight is not any shipped preset, and
 * calling it one anyway would be a scoreboard-shaped lie on the one page (`/browse`) a stranger
 * uses to decide whether to join — so anything that doesn't match a preset exactly reads
 * "Custom" rather than the closest guess.
 */
export function describeScoring(settings: ScoringRules): string {
  const match = PRESET_LABELS.find(([weights]) => sameWeights(settings, weights));
  return match === undefined ? "Custom" : match[1];
}
