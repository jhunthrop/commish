import { INTEGRITY_CONFIG } from "./config";

/**
 * THE house rules for copy this product writes in its own voice, in one implementation.
 *
 * There used to be two rulebooks. Notice templates were swept for accusatory terms, passive
 * constructions and dashes; activity headlines were swept for dashes only. The asymmetry was
 * visible in the activity sweep's own fixture, which was itself one of the passive constructions
 * the other surface bans. Both surfaces are read by the same member, on the same page, minutes
 * apart, so there is one rulebook and this is it.
 *
 * The five rules, and why each is mechanical rather than a review note:
 *
 *  - NO EM OR EN DASH. The founder rule. Two characters, not one: an en dash reads as an em dash
 *    at body size and every sweep in this repo that checked only `—` has missed `–` at least
 *    once.
 *  - NOTHING ACCUSATORY (`INTEGRITY_CONFIG.notices.accusatoryTerms`). Copy here explains what the
 *    PLATFORM did. It never suggests the member did something wrong, because the member is
 *    reading it at the moment they are least inclined to give us the benefit of the doubt.
 *  - NO PASSIVE CONSTRUCTION (`INTEGRITY_CONFIG.notices.passiveConstructions`). "Was removed",
 *    "was made", "is kept" all hide who did the thing, and the answer is always "we did".
 *  - NO CONTRACTION (C1, ruled — `docs/design-system.md`, "Copy"). "You do not have to wait
 *    here," never "You don't." This product tells people things about money, seats and fairness,
 *    and the expanded register is what keeps those sentences from reading as chat. Matches the
 *    closed set of English contractions (negation, `'re`/`'ve`/`'ll`/`'d`/`'m`, and the
 *    interrogative/pronoun `'s` forms) rather than every apostrophe-`s` in the language, so a
 *    genuine possessive ("the commissioner's note") is left alone. **One named exception**
 *    (`CONTRACTION_ALLOWLIST`): the just-seated heading, `` `${leagueName} · You're in` ``
 *    (`waiting-room.tsx`, D1) — recorded as a decision somebody made once, not a precedent the
 *    next writer generalizes from, so it is allowlisted by exact phrase rather than by loosening
 *    the rule.
 *  - NOTHING FROM THE FORBIDDEN VOCABULARY (C3, ruled; extended Phase 4.5). No surface invents
 *    "autopick," "auto-draft," or "we will draft for you" — the one sanctioned phrase for the
 *    safety net is "the room picks for you: your queue first, then the best player your roster
 *    needs" (amended 2026-09-03 with the need-aware autopick upgrade — the old queue-only
 *    phrasing stopped being the whole truth), and every surface that reassures a member about
 *    missing a draft quotes it exactly. Phase 4.5 adds the mock draft's own honesty
 *    floor beside it: no surface calls a bot an "AI opponent," "smart AI," or claims it "learns
 *    from" anything or uses "machine learning" — a mock bot is a named, seeded sampler, and no
 *    claim of intelligence is true until Phase 6 actually ships one.
 *
 * A rule about copy is only real if something checks the copy, which is why this returns every
 * violation rather than a boolean: a failing sweep should name the rule and the words that broke
 * it, not just go red.
 */
export interface CopyViolation {
  readonly rule: "dash" | "accusatory" | "passive" | "contraction" | "forbiddenVocabulary" | "tradingVocabulary";
  readonly found: string;
}

const DASHES = /[—–]/g;

/**
 * The closed set of English contractions this house style expands, as one alternation:
 * negation (`isn't`, `can't`, ... `'t`), the four verb-elision suffixes on `I/you/we/they`, `I'm`,
 * and the `'s`/`'d` forms on the pronouns and interrogatives they actually attach to (`it's`,
 * `who's`, `there's`, `nobody's`, `that'd`, ...). Deliberately NOT `\w+'s` — that would also flag
 * every possessive in the product ("the league's median", "a manager's roster"), which C1 never
 * ruled on and this sweep has no business rewriting.
 *
 * `can't` IS SPELLED OUT (integrity cleanup review, MEDIUM-1). This docblock named it from the
 * day it was written, but the alternation never carried it: `can` is not one of the auxiliaries
 * in the `…n't` group (its negation elides the `no`, so "cann't" is not a word), and only
 * `ain't`/`won't`/`shan't` were listed as irregulars. The sweep therefore expanded
 * "You're the high bidder" one line above "You can't afford the current bid" and flagged only the
 * first. `won't` is listed; `don't`, `isn't` and `aren't` already fall out of the `(?:do|is|are)n't`
 * group and need no entry of their own.
 */
const CONTRACTIONS =
  /\b(?:ain't|can't|won't|shan't|(?:is|are|was|were|does|do|did|has|have|had|could|would|should|might|must|need|dare)n't|(?:I|you|we|they)'(?:re|ve|ll|d)|I'm|(?:it|that|this|there|here|what|who|where|when|why|how|let|nobody|somebody|everybody|everyone|someone|nothing|one)'(?:s|d)|y'all|ma'am|o'clock)\b/gi;

/**
 * The exact phrases the contraction sweep never flags. Subtracted from the text before the
 * `CONTRACTIONS` scan runs, so the allowlist is a string match rather than a second regex that
 * could drift out of sync with the first.
 */
const CONTRACTION_ALLOWLIST: readonly string[] = ["You're in"];

/**
 * C3's forbidden vocabulary family — the words this product's copy never invents for the
 * safety-net idea, because "the room picks for you: your queue first, then the best player
 * your roster needs" is the one sanctioned phrase
 * and a second name for the same idea is exactly the "two names for one idea" confusion the
 * first-timer persona flagged.
 *
 * Phase 4.5's own addition, beside it rather than a second family: the mock draft's bot vocabulary
 * ban. A mock room's bots are named, seeded samplers (`MOCK_CONFIG.botRoster`, `@/mock-draft`) —
 * "practice opponent," never "AI." This phase's honesty floor is that no surface may claim a bot
 * is intelligent or that it learns, because neither is true yet: Phase 6 is the phase that ships
 * actual learning, and a claim made two phases early is a claim this product cannot back up the
 * moment a member asks how. Enforced by the SAME four sweeps that enforce C3 — one rulebook, one
 * `copyViolations`, no second implementation to drift out of sync with this one.
 */
const FORBIDDEN_VOCABULARY: readonly string[] = [
  "autopick",
  "auto-pick",
  "autodraft",
  "auto-draft",
  "auto draft",
  "we'll draft for you",
  "we will draft for you",
  "ai opponent",
  "smart ai",
  "learns from",
  "machine learning",
];

/**
 * THE TRADING-VOCABULARY BAN (founder, 2026-09-07: "we say market everywhere like this is a stock
 * trading app, it's a fantasy football app"). Every word a manager reads is fantasy football's
 * own: ADP, a reach, a steal, "drafters take him later", "he is going later than he should".
 * Market, price, buy, sell, fade, undervalued, overvalued, discount, dividend and "trade at" are a
 * trader's words and never render.
 *
 * ITS OWN FUNCTION, NOT A SIXTH CLAUSE OF `copyViolations`, on purpose: the script sweep
 * (`script-copy.source.test.ts`) applies `copyViolations` to what an OPERATOR reads on a
 * terminal, and the fitting scripts honestly print "market curve" about the ADP model they fit.
 * The ruling is about what a manager reads, so `fantasy-words.source.test.ts` applies this to the
 * manager-facing directories and the operator sweep is left alone.
 *
 * Stems rather than exact phrases, word-bounded, because the ban is on the vocabulary and not on
 * one sentence: "underpricing", "overpriced" and "prices" fail the same way "price" does.
 */
const TRADING_VOCABULARY =
  /\b(?:markets?|prices?|priced|pricing|underpric\w*|overpric\w*|buys?|buying|bought|sells?|selling|sold|fades?|fading|undervalued|overvalued|premium|discounts?|discounted|dividends?)\b|\btrades? at\b|\bthe price is wrong\b|\bour number (?:versus|vs\.?) the market\b/gi;

/**
 * The phrases the trading sweep never flags, subtracted (case-insensitively) before the scan:
 *
 *  - "buy-in": fantasy's own word for the entry fee. The ban is on the trader's verb.
 *  - "TE premium" (and its `te_premium`/`te-premium` keys): a scoring format, never a price.
 *  - "premium research": the product term (`docs/research/2026-09-07-premium-research-tier-legal-questions.md`).
 *  - "sell personal information": the privacy page's legal sentence, not draft advice.
 *  - `market_anchor`, `market_unlisted`, `market-order-note`: internal identifiers a source scan
 *    sees as string literals (a `BoardReason` code in a `case`, a `data-testid`). They render
 *    nothing, and renaming a reason code is a projections-engine change, not a copy one.
 */
const TRADING_ALLOWLIST: readonly string[] = [
  "buy-in",
  "TE premium",
  "te_premium",
  "te-premium",
  "premium research",
  "sell personal information",
  "market_anchor",
  "market_unlisted",
  "market-order-note",
];

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tradingVocabularyViolations(text: string): readonly CopyViolation[] {
  const withoutAllowlisted = TRADING_ALLOWLIST.reduce((acc, phrase) => acc.replace(new RegExp(escapeRegExp(phrase), "gi"), " "), text);
  return [...withoutAllowlisted.matchAll(TRADING_VOCABULARY)].map((match): CopyViolation => ({ rule: "tradingVocabulary", found: match[0] }));
}

export function copyViolations(text: string): readonly CopyViolation[] {
  const lower = text.toLowerCase();
  const withoutAllowlisted = CONTRACTION_ALLOWLIST.reduce((acc, phrase) => acc.split(phrase).join(""), text);
  return [
    ...[...text.matchAll(DASHES)].map((match): CopyViolation => ({ rule: "dash", found: match[0] })),
    ...INTEGRITY_CONFIG.notices.accusatoryTerms
      .filter((term) => lower.includes(term))
      .map((term): CopyViolation => ({ rule: "accusatory", found: term })),
    ...INTEGRITY_CONFIG.notices.passiveConstructions
      .filter((phrase) => lower.includes(phrase))
      .map((phrase): CopyViolation => ({ rule: "passive", found: phrase })),
    ...[...withoutAllowlisted.matchAll(CONTRACTIONS)].map((match): CopyViolation => ({ rule: "contraction", found: match[0] })),
    ...FORBIDDEN_VOCABULARY.filter((term) => lower.includes(term)).map((term): CopyViolation => ({ rule: "forbiddenVocabulary", found: term })),
  ];
}
