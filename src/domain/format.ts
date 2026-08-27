/**
 * "1st", "2nd", "3rd", "4th", ... "11th", "21st" — the English ordinal suffix rule, exceptions
 * (11-13) first. Hoisted into the domain (wave-1 review Q9): the draft room's own pick-review
 * sentences and the admin room's settle-confirm standings both said this, as two separate
 * five-line copies (`@/draft-room/state/format`'s own `formatOrdinal`, `@/admin-room/components/
 * settle-league-control`'s local `ordinal`) that could only ever drift apart, never disagree on
 * purpose. Lives here rather than in either room because both rooms may legally import `@/domain`
 * directly (`eslint.config.mjs`'s boundary rules; not a browser-safe-exemption case, `@/domain`
 * needs none), the same reason `formatClockLength`/`plural` already live in `@/domain/duration`
 * beside it.
 *
 * Plain arithmetic rather than an `Intl.PluralRules` lookup: every caller's own range is small
 * and closed (a draft board's player count, a settle roster's own standings), and a five-line
 * rule reads just as clearly.
 */
export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
