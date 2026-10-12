/**
 * NUMBER GROUNDING (written rate round fix, 2026-09-08) — how a number in a text is read, and when
 * it counts as an honest reading of a ledger. Moved out of `validate.ts` unchanged; that file is
 * the law's enforcement arm and this is the arithmetic it enforces with. Pure: no facts, no
 * rendering, no prompt.
 */


/** `(?<![A-Za-z0-9])`/`(?![A-Za-z])` keep this from pulling the "6" out of "RB6" or the "12" out
 *  of "Q12" — a position/market-rank compound token is not a bare number, and validating its
 *  digits against the ledger would demand a `positionAdp`-style string be represented numerically
 *  too. The lookbehind ALSO excludes a preceding DIGIT (fix round 1, MEDIUM d) so the leading `-`
 *  in a range or a year span ("20-25 touches", "2023-2024") is never consumed as a sign: at the
 *  position right after "20", the previous character is a digit, so a match cannot START there,
 *  and the regex engine instead starts fresh at the digit right after the hyphen — "25", positive,
 *  never "-25". A genuine negative ("-1.8 a game") is untouched: the character before its `-` is
 *  a space, not alphanumeric, so the sign is still consumed normally. */
const NUMBER_TOKEN_PATTERN = /(?<![A-Za-z0-9])-?\d[\d,]*(?:\.\d+)?%?(?![A-Za-z])/g;

/** Spelled-out cardinals one through twenty (fix round 1, HIGH) — "he caught seven passes" is
 *  otherwise invisible to `extractNumbers`, which reads digits only. Capped at twenty: past that,
 *  analyst prose overwhelmingly reverts to digits ("he ran for 340 yards"), so there is no real
 *  coverage gap above it worth the false-positive risk of matching an ordinary sentence's stray
 *  number word in a longer list. */
const CARDINAL_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};
const CARDINAL_WORD_PATTERN = new RegExp(`\\b(${Object.keys(CARDINAL_WORDS).join("|")})\\b`, "gi");

/** The tens from thirty to ninety, and the compounds they make with a unit ("twenty-eight",
 *  "forty five") — written rate round, 2026-09-08: "Twenty-eight is the front edge of receiver
 *  decline" was read as the number 20. A compound is one number and is read before the single
 *  words are, with its span blanked so its first word cannot be read again on its own. */
const TENS_WORDS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const UNIT_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
const COMPOUND_CARDINAL_PATTERN = new RegExp(`\\b(${Object.keys(TENS_WORDS).join("|")})(?:[-\\s](${UNIT_WORDS.join("|")}))?\\b`, "gi");

function compoundCardinalValue(tens: string, unit: string | undefined): number {
  return TENS_WORDS[tens.toLowerCase()]! + (unit === undefined ? 0 : CARDINAL_WORDS[unit.toLowerCase()]!);
}

/** Ordinals 1st through 30th (fix round 1, HIGH) — "his 3rd season", "in his 21st start". The
 *  leading `\b` already excludes a compound token ("RB21st" has no boundary between "B" and "2"),
 *  so this needs no separate digit-only guard the way `NUMBER_TOKEN_PATTERN` does. */
const ORDINAL_PATTERN = /\b([1-9]|1[0-9]|2[0-9]|30)(st|nd|rd|th)\b/gi;

export function extractNumbers(text: string): readonly { readonly raw: string; readonly value: number }[] {
  const digitMatches = text.match(NUMBER_TOKEN_PATTERN) ?? [];
  const digitNumbers = digitMatches
    .map((raw) => ({ raw, value: Number(raw.replace(/,/g, "").replace(/%$/, "")) }))
    .filter((n) => Number.isFinite(n.value));

  const compoundNumbers = [...text.matchAll(COMPOUND_CARDINAL_PATTERN)].map((match) => ({ raw: match[0], value: compoundCardinalValue(match[1]!, match[2]) }));
  const withoutCompounds = text.replace(COMPOUND_CARDINAL_PATTERN, " ");
  const cardinalNumbers = [...withoutCompounds.matchAll(CARDINAL_WORD_PATTERN)].map((match) => ({ raw: match[0], value: CARDINAL_WORDS[match[1]!.toLowerCase()]! }));
  const ordinalNumbers = [...text.matchAll(ORDINAL_PATTERN)].map((match) => ({ raw: match[0], value: Number(match[1]) }));

  return [...digitNumbers, ...compoundNumbers, ...cardinalNumbers, ...ordinalNumbers];
}

/**
 * Half-away-from-zero rounding to `decimals` places — what a person means by "rounded", and what
 * `toFixed` does NOT reliably do: `(2.55).toFixed(1)` is "2.5", because 2.55 is not 2.55 in binary.
 * That single discrepancy was rejecting honest capsules (measured 2026-09-07: "2.6" against a
 * ledgered 2.55 read as a fabricated number).
 */
export function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + Number.EPSILON * factor)) / factor;
}

/**
 * `value` is an honest reading of some entry in `ledger` when it equals that entry, or a plain
 * rounding of it, or the whole-percent form of a fraction on it — "a fabricated number is caught;
 * a rounded one passes" is the explicit bar this function exists to clear.
 *
 * ROUNDED AT ANY OF THE THREE PRECISIONS A PERSON WRITES (capsule acceptance round, 2026-09-07,
 * after a measured one-in-ten pass rate whose top rejection category was a rounded ledger value):
 * zero, one or two decimals, half away from zero. A written number that matches the entry at ANY
 * of the three is an honest reading of it, which is how "2.6", "2.55" and "3" are all honest
 * readings of a ledgered 2.55 while "3.4" is a reading of nothing.
 *
 * THE PERCENT FORM of a fraction is grounded too: a share of 0.2476 on the ledger grounds "24.8%",
 * "25%" and "24.76%" alike. Bounded to |entry| <= 1 so this can only ever turn a FRACTION into a
 * percentage, never license an arbitrary hundred-fold restatement of a points total.
 */
/**
 * THE LOOSE READINGS OF A LARGE PRINTED FIGURE (written rate round, 2026-09-08). A person states a
 * total to the ten from a hundred up ("360-point seasons" for 362.9) and to the hundred from a
 * thousand up ("1400-plus yards" for 1429), down or to the nearest. Each unit applies only from its
 * own threshold, so a figure under a hundred is never read loosely: an ADP of 12.5 is never "pick
 * 10", and 143 is never "100".
 *
 * OF WHAT THE SHEET PRINTS ONLY, never of a derived value: the ledger carries every difference and
 * product of two printed facts, and a loose reading of each of those would blanket three-figure
 * space (275 minus 178 is 97, and 97 read to the ten is "100"). The 282 a rate-times-games
 * derivation reaches is quotable as 282; "clears 280" of it still fails, and that is the bound.
 */
const LOOSE_READING_UNITS: readonly { readonly from: number; readonly unit: number }[] = [
  { from: 100, unit: 10 },
  { from: 1000, unit: 100 },
];

function looseReadings(entry: number): readonly number[] {
  const magnitude = Math.abs(entry);
  return LOOSE_READING_UNITS.filter(({ from }) => magnitude >= from).flatMap(({ unit }) => [Math.floor(magnitude / unit) * unit, Math.round(magnitude / unit) * unit]);
}

export function isLooseReadingOf(value: number, printed: readonly number[]): boolean {
  return printed.some((entry) => looseReadings(entry).includes(Math.abs(value)));
}

export function isDerivedFromLedger(value: number, ledger: readonly number[], allowMagnitude = true): boolean {
  for (const entry of ledger) {
    if (value === entry) return true;
    if (Math.trunc(entry) === value || Math.ceil(entry) === value || Math.floor(entry) === value) return true;
    // THE MAGNITUDE OF A SIGNED FACT (acceptance round, task 10): a law worth -10.9 a game is
    // stated by this product's own template as "costs him 10.9 points a game", and the writer is
    // told to use that verb too. The sign lives in the sentence, so an unsigned 10.9 is a reading
    // of -10.9, not a different number. (`citesTensionNumber` already granted exactly this for the
    // one mandated citation; it belongs to every number.)
    const magnitudes = allowMagnitude ? [Math.abs(entry)] : [];
    const percents = Math.abs(entry) <= 1 ? [entry * 100, ...magnitudes.map((m) => m * 100)] : [];
    for (const candidate of [entry, ...percents, ...magnitudes]) {
      if (candidate === value) return true;
      if (roundHalfUp(candidate, 0) === value || roundHalfUp(candidate, 1) === value || roundHalfUp(candidate, 2) === value) return true;
    }
  }
  return false;
}
/**
 * THE NUMBERS THE PROMPT ACTUALLY SHOWED HIM (acceptance round, task 10) — every numeric token in
 * the rendered fact sheet, in the exact forms it was rendered in.
 *
 * THE MEASUREMENT THAT FORCED IT: 125 of the rejections in a 100-player live run were ungrounded
 * numbers, and the examples were figures the sheet had printed. `render.ts` states a share as
 * "34.5%" while the ledger carried the fraction, states a rank as "RB4 of 32" while the ledger
 * carried the components, and rounds a season total for readability. Every one of those is the
 * model reading its own fact sheet back, which is the opposite of a fabrication.
 *
 * GROUNDING BY CONSTRUCTION. Anything the prompt renders is quotable; anything else still has to
 * trace to the structured ledger or to an honest rounding of it. This cannot license an invented
 * number, because the prompt is built from the same facts by a pure function
 * (`renderFactsForModel`) that invents nothing either.
 *
 * Recomputed per validation rather than stored on `PlayerFacts`: the fact sheet is a few hundred
 * bytes of string building, and putting it on the facts object would make `facts.ts` depend on the
 * renderer that already depends on it.
 */
export function promptNumbers(promptText: string): readonly number[] {
  return extractNumbers(promptText).map((token) => token.value);
}
