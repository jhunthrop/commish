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

/** A season total is stated to the ten from a hundred up. */
const STATED_TO_THE_TEN_FROM = 100;
const TEN = 10;

/** A value with the two ways a person states it to the ten (down and nearest), when it is large
 *  enough to be stated that way; the value alone otherwise. */
function statedToTheTen(value: number): readonly number[] {
  if (Math.abs(value) < STATED_TO_THE_TEN_FROM) return [value];
  return [value, Math.floor(value / TEN) * TEN, Math.round(value / TEN) * TEN];
}

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
 */
export function derivedNumbers(facts: FactsContent): readonly number[] {
  const { market, projection, availability, season, lastSeasonStory } = facts;
  const numbers: number[] = [];

  // EVERY HEADLINE POINTS FIGURE AGAINST OUR NUMBER, both signs: the replacement the sheet names,
  // the market anchor, the two tails, last season's total, this season's. Anchored on our number
  // rather than every pair against every other: eight figures make twenty-eight pairwise
  // differences, most of them small integers, and that licensed a fabricated "37 touchdowns".
  const againstOurNumber = [
    projection.floorPoints,
    projection.ceilingPoints,
    ...(market.replacementLevel === null ? [] : [market.replacementLevel]),
    ...(market.marketAnchorPoints === null ? [] : [market.marketAnchorPoints]),
    ...(lastSeasonStory === null ? [] : [lastSeasonStory.pointsRank.value]),
    ...(season === null ? [] : [season.totals.fantasyPoints]),
  ];
  for (const figure of againstOurNumber) numbers.push(projection.projectedPoints - figure, figure - projection.projectedPoints);

  // The width of each band, which is how a reader says "a ninety point spread".
  numbers.push(projection.typicalHigh - projection.typicalLow, projection.ceilingPoints - projection.floorPoints);

  // THE GAMES FIGURES THE SHEET PRINTS, and every per-game rate on it times each of them: a full
  // season, the games this engine expects, the low and high of that range, the games he has played.
  const games = [
    GAMES_IN_A_SEASON,
    ...(availability === null ? [] : [availability.expectedGames, availability.floorGames, availability.ceilingGames]),
    ...(season === null ? [] : [season.gamesPlayed]),
    ...(lastSeasonStory === null ? [] : [lastSeasonStory.gamesPlayed]),
  ];
  // A person states the product to the ten ("roughly 140" for 10.7 times 13, "clears 280" for
  // 21.7 times 13), so each product carries its floor and nearest ten beside it. Here, by
  // construction on these few products, never as a validator tolerance over every derived value.
  const rates = [...(season === null ? [] : [season.pointsPerGame]), ...(lastSeasonStory === null ? [] : [lastSeasonStory.pointsPerGame])];
  for (const rate of rates) for (const played of games) numbers.push(...statedToTheTen(rate * played));

  // Per game, both ways a person computes it: over a full season, and over the games this engine
  // actually expects him to play, plus the games that expectation leaves on the table.
  numbers.push(projection.projectedPoints / GAMES_IN_A_SEASON);
  if (availability !== null && availability.expectedGames > 0) {
    numbers.push(projection.projectedPoints / availability.expectedGames, GAMES_IN_A_SEASON - availability.expectedGames);
  }

  // THE LAW EFFECTS COMBINED: any two of them, and all of them ("a combined 5.6 a game").
  const effects = facts.evidence.flatMap((item) => (item.kind === "law" ? [item.netEffectPoints] : []));
  for (let i = 0; i < effects.length; i += 1) for (let j = i + 1; j < effects.length; j += 1) numbers.push(effects[i]! + effects[j]!);
  if (effects.length > 2) numbers.push(effects.reduce((total, effect) => total + effect, 0));

  // A SEASON TOTAL AS THE SUM OF ITS LISTED PARTS: yards from scrimmage, all yards, touches.
  if (season !== null) {
    const t = season.totals;
    numbers.push(t.rushingYards + t.receivingYards, t.rushingYards + t.receivingYards + t.passingYards);
    if (t.carries !== null) numbers.push(t.carries + t.receptions);
  }
  return numbers;
}
