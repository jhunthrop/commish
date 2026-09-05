/**
 * ROUNDS TO QUARTERS, honestly. The extremes get their own words rather than a misleading
 * "about 1 in 1" or "about 0 in 4" — nobody reads "better than 9 in 10" as a promise, but a
 * rounded quarter at the edges reads as false precision in the other direction. The product's ONE
 * quarter-phrasing: `drawer-assistant-tab.tsx` (candidate make-it-back lines and `reasonSentence`)
 * and `beat.ts` (the post-pick beat) both import this same export rather than each carrying its
 * own copy — a pure string formatter belongs beside `reads.ts`/`roster-fit.ts`, not inside a
 * "use client" component, which would otherwise force a decision module to depend on React.
 */
export function oddsPhrase(survival: number): string {
  if (survival > 0.9) return "better than 9 in 10";
  if (survival < 0.1) return "long odds";
  const quarter = Math.round(survival * 4) / 4;
  switch (quarter) {
    case 0.25:
      return "about 1 in 4";
    case 0.5:
      return "about 1 in 2";
    case 0.75:
      return "about 3 in 4";
    default:
      return survival >= 0.5 ? "better than 9 in 10" : "long odds";
  }
}
