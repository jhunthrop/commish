// SERVER ONLY: `node:crypto` cannot be bundled for the browser. This module is deliberately NOT
// re-exported from `@/scoring`'s barrel, because that barrel is value-imported by client code
// (the Draft HQ board view reaches it through the kicker and defense season lines), and the
// 2026-09-07 deploy failed on exactly that path. Import it as `@/scoring/hash` from server code only.
import { createHash } from "node:crypto";
import { STANDARD_SCORING, type ScoringSettings } from "@/domain/scoring";
import { SCORING_TIER_TABLES, type ScoringRules } from "./compute";

/**
 * THE STABLE IDENTITY OF A RULE SET (peek document design, 2026-09-07).
 *
 * A fantasy point is a property of a player inside a rule set, so a precomputed document that
 * scores weekly points is only reusable across leagues that score them identically. This function
 * is what "identically" means, and it is ONE function: the document writer keys its rows on it, the
 * league row stores it, and the settings write path recomputes it. Two spellings of this question
 * would let a document be served to a league it was never scored for, which is the one failure this
 * whole design cannot survive.
 *
 * WHAT GOES IN. Every tunable weight the product carries, taken from `STANDARD_SCORING`'s own keys
 * rather than listed again here, so a widened scoring vocabulary cannot be silently left out of the
 * identity of a rule set. Plus the engine's fixed defense tier tables (`SCORING_TIER_TABLES`): a
 * commissioner does not tune them today, but they decide what a DEF week is worth, so a change to
 * them must invalidate every stored document exactly as a weight change does.
 *
 * WHAT DOES NOT. `leagueId`, which is the one field on `ScoringSettings` that is about WHOSE rules
 * these are rather than what they say. Two leagues running PPR get one hash and share one document,
 * which is the entire economy of this design.
 *
 * KEY ORDER NEVER MATTERS: the keys are sorted before hashing, so a row read back from Postgres in
 * column order and a preset written by hand in the order someone thought of them produce the same
 * digest. `Infinity` in a tier ceiling is written out as the string "Infinity" rather than left to
 * `JSON.stringify`, which turns it into `null` and would collapse an open-ended bracket into an
 * absent one.
 */
export function scoringHashOf(rules: ScoringRules | ScoringSettings): string {
  const weights = Object.keys(STANDARD_SCORING)
    .sort()
    .map((key): readonly [string, number] => [key, requireWeight(rules, key)]);
  const tiers = Object.keys(SCORING_TIER_TABLES)
    .sort()
    .map((name): readonly [string, readonly string[]] => [name, describeTiers(SCORING_TIER_TABLES[name]!)]);
  return createHash("sha256").update(JSON.stringify({ weights, tiers })).digest("hex");
}

/** A weight that is absent is a rule set this function refuses to give an identity to: hashing an
 *  `undefined` would mint a digest that looks like a real rule set and scores nothing. */
function requireWeight(rules: ScoringRules | ScoringSettings, key: string): number {
  const value = (rules as unknown as Record<string, unknown>)[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`scoringHashOf: ${key} must be a finite number, got ${JSON.stringify(value)}.`);
  }
  return value;
}

/** One tier table as text, with an open-ended ceiling spelled out rather than serialized away. */
function describeTiers(table: readonly (readonly [number, number])[]): readonly string[] {
  return table.map(([ceiling, points]) => `${Number.isFinite(ceiling) ? ceiling : "Infinity"}:${points}`);
}
