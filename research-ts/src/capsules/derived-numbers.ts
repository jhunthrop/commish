import type { PlayerFacts } from "./facts";

/**
 * THE NUMBER LEDGER'S CONSTRUCTED HALF (written rate round fix, 2026-09-08) — every number a
 * capsule may cite that the fact sheet does not carry as a measured quantity: the arithmetic on two
 * printed facts (`derivedNumbers`) and the figures inside printed text (`printedTextNumbers`).
 * Moved out of `facts.ts` unchanged; that file builds the facts and this file says what a reader
 * may compute from them. `facts.ts` is the one caller.
 */

/** The facts as the ledger builders read them: every content field, before the ledgers exist. */
export type FactsContent = Omit<PlayerFacts, "numberLedger" | "nameLedger" | "factsHash">;

/** Regular-season games, the divisor a per-game rate off a season projection uses. Stated here
 *  rather than imported from `decide/tiers.ts` so this pure fact module keeps its own no-imports
 *  posture toward the projection engine; the two are the same seventeen and always will be. */
const GAMES_IN_A_SEASON = 17;

/**
 * EVERY NUMBER THE FACT SHEET PRINTS THAT IS NOT A MEASURED QUANTITY (capsule acceptance round) —
 * the dated stamp on the injury line and the figures inside the headlines `render.ts` quotes
 * verbatim. The rule the acceptance measurement settled on is "every number the prompt SHOWS the
 * model is grounded", and both of these are on the page in front of it: a capsule saying "as of
 * September 1" or quoting a headline's own draft pick is reading, not inventing.
 *
 * NAMES INSIDE A HEADLINE ARE DELIBERATELY NOT LEDGERED. A number in a headline is a fact the
 * sheet states; a PERSON in a headline is a teammate this engine has measured nothing about, and
 * naming him is exactly the fabrication the name check exists to stop.
 */
export function printedTextNumbers(facts: FactsContent): readonly number[] {
  const numbers: number[] = [];
  if (facts.injury.state !== "unknown") {
    for (const part of facts.injury.asOf.slice(0, 10).split("-")) numbers.push(Number(part));
  }
  for (const story of facts.news) {
    for (const raw of `${story.title} ${story.publishedAt?.slice(0, 10) ?? ""}`.match(/\d+(?:\.\d+)?/g) ?? []) numbers.push(Number(raw));
  }
  return numbers.filter((value) => Number.isFinite(value));
}

/**
 * THE DERIVED FIGURES (capsule acceptance round, 2026-09-07) — every number a reader gets by
 * SUBTRACTING or DIVIDING two figures the fact sheet already shows him.
 *
 * The measured failure this closes: the top rejection category was an ungrounded number, and the
 * examples were not fabrications at all. "20" was the projection minus the replacement level, a
 * subtraction of two printed facts; a per-game figure was the season total over seventeen. The
 * validator was right that the model computed them and wrong that they were invented, and the fix
 * belongs in the ledger rather than in a looser check: these are the arithmetic a MODULE on the
 * same page already performs and displays, so the writer may state them too.
 *
 * A DERIVATION IS ONLY LISTED WHEN BOTH ITS INPUTS ARE ON THE SHEET. Nothing here invents a third
 * quantity out of one, and a number that is neither on the sheet nor one of these still fails.
 *
 * WIDENED BY MEASUREMENT (written rate round, 2026-09-08). A 40-player dev run's ungrounded
 * numbers, classified by hand, held three honest derivations the ledger did not carry: a per-game
 * rate times a games figure the sheet prints ("21.7 a game over a 13-game season clears 282"), the
 * sum of two law effects ("worth a combined 5.6 a game"), and headline figures read against each
 * other. Every pair below is two printed facts and one operation; the fabrications the same run
 * held ("300-touch legs", a pick the writer chose) trace to none of them and still fail.
 *
 * AND KEPT SMALL (fix round, 2026-09-08, HIGH): coincidence space is the size of this list, so a
 * rate meets only its own season's games, the law effects give one total, and the differences are
 * anchored on our number. A player with five law effects, availability, a played season and a
 * prior season carries 23 derived values.
 */
export function derivedNumbers(facts: FactsContent): readonly number[] {
  return [...pointsDifferences(facts), ...rateTimesGamesNumbers(facts), ...perGameNumbers(facts), ...lawEffectTotal(facts), ...seasonTotalSums(facts)];
}

/**
 * EVERY HEADLINE POINTS FIGURE AGAINST OUR NUMBER, both signs: the replacement the sheet names,
 * the market anchor, the two tails, last season's total, this season's. Anchored on our number
 * rather than every pair against every other: eight figures make twenty-eight pairwise
 * differences, most of them small integers, and that licensed a fabricated "37 touchdowns". Plus
 * the width of each band, which is how a reader says "a ninety point spread".
 */
export function pointsDifferences(facts: FactsContent): readonly number[] {
  const { market, projection, season, lastSeasonStory } = facts;
  const againstOurNumber = [
    projection.floorPoints,
    projection.ceilingPoints,
    ...(market.replacementLevel === null ? [] : [market.replacementLevel]),
    ...(market.marketAnchorPoints === null ? [] : [market.marketAnchorPoints]),
    ...(lastSeasonStory === null ? [] : [lastSeasonStory.pointsRank.value]),
    ...(season === null ? [] : [season.totals.fantasyPoints]),
  ];
  return [
    ...againstOurNumber.flatMap((figure) => [projection.projectedPoints - figure, figure - projection.projectedPoints]),
    projection.typicalHigh - projection.typicalLow,
    projection.ceilingPoints - projection.floorPoints,
  ];
}

/**
 * A RATE TIMES GAMES, SAME-SEASON PAIRINGS ONLY (fix round, 2026-09-08, HIGH): this season's
 * per-game rate times the games this engine expects of him, last season's rate times the games he
 * played that season. Every rate times every games figure was coincidence space, and the raw
 * product is pushed once: the validator already reads it at three roundings.
 */
export function rateTimesGamesNumbers(facts: FactsContent): readonly number[] {
  const { availability, season, lastSeasonStory } = facts;
  return [
    ...(season !== null && availability !== null ? [season.pointsPerGame * availability.expectedGames] : []),
    ...(lastSeasonStory === null ? [] : [lastSeasonStory.pointsPerGame * lastSeasonStory.gamesPlayed]),
  ];
}

/** Per game, both ways a person computes it: over a full season, and over the games this engine
 *  actually expects him to play, plus the games that expectation leaves on the table. */
function perGameNumbers(facts: FactsContent): readonly number[] {
  const { projection, availability } = facts;
  const overExpected = availability !== null && availability.expectedGames > 0 ? [projection.projectedPoints / availability.expectedGames, GAMES_IN_A_SEASON - availability.expectedGames] : [];
  return [projection.projectedPoints / GAMES_IN_A_SEASON, ...overExpected];
}

/** THE LAW EFFECTS COMBINED: the grand total of all of them, never a pairwise sum (fix round,
 *  2026-09-08: five effects make ten pairs, and ten small numbers is coincidence space). Empty for
 *  a single effect, which is already on the ledger as itself. */
export function lawEffectTotal(facts: FactsContent): readonly number[] {
  const effects = facts.evidence.flatMap((item) => (item.kind === "law" ? [item.netEffectPoints] : []));
  return effects.length > 1 ? [effects.reduce((total, effect) => total + effect, 0)] : [];
}

/** A SEASON TOTAL AS THE SUM OF ITS LISTED PARTS: yards from scrimmage, all yards, touches. */
export function seasonTotalSums(facts: FactsContent): readonly number[] {
  const season = facts.season;
  if (season === null) return [];
  const t = season.totals;
  return [t.rushingYards + t.receivingYards, t.rushingYards + t.receivingYards + t.passingYards, ...(t.carries === null ? [] : [t.carries + t.receptions])];
}
