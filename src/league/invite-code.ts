import { LEAGUE_CONFIG } from "./config";

/**
 * A short code a person can read aloud and type: no I, L, O, 0 or 1. Randomness is INJECTED
 * so this module stays pure and its output is reproducible in a test and in a seed; the
 * caller (`src/league-service/invites.ts`) supplies `Math.random` at the edge.
 */
export function generateInviteCode(random: () => number): string {
  const { alphabet, codeLength } = LEAGUE_CONFIG.invite;
  return Array.from({ length: codeLength }, () => alphabet[Math.floor(random() * alphabet.length)]!).join("");
}
