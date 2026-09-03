import { moneyIsLive } from "./states";

/**
 * The two money sentences the storefront's one money line can render — a PURE module (front
 * door blueprint, 2026-09-02) because both sides of the client boundary read them: the server
 * hero (`front-door-hero.tsx`) and the client join/create sheets. One source, so the sentence
 * and the config can never disagree; `LIVE_MONEY_SENTENCE` gives way only once a state is
 * enabled (`MONEY_STATES.enabled`, founder decision 7), which no build ships with today.
 */
export const FREE_SEASON_SENTENCE = "Every league is free this season.";
export const LIVE_MONEY_SENTENCE = "Play free everywhere, or play for real money where your state allows.";

/** `live` defaults to the real switch; callers that inject for tests pass their own. */
export function moneySentence(live: boolean = moneyIsLive()): string {
  return live ? LIVE_MONEY_SENTENCE : FREE_SEASON_SENTENCE;
}
