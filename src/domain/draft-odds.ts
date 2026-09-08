/**
 * THE SURVIVAL BANDS — where a "still there at your next pick" fraction sits, named once for
 * the server that states the odds and the client that colours them (a client component may not
 * value-import `@/draft-service/**`, and a threshold that lived only on one side would drift).
 *
 * `safe` is the old plan's fallback floor (a player the simulator leaves on the board this often
 * is one you can wait on), `reach` is its reach floor (below it, waiting is a reach). Between the
 * two is the ordinary middle.
 */
export const SURVIVAL_BANDS = {
  safe: 0.7,
  reach: 0.25,
} as const;

export type SurvivalBand = "safe" | "middle" | "reach";

export function survivalBand(survival: number): SurvivalBand {
  if (survival >= SURVIVAL_BANDS.safe) return "safe";
  if (survival < SURVIVAL_BANDS.reach) return "reach";
  return "middle";
}
