import { MATCHMAKING_CONFIG } from "./config";
import type { BrowseFilter, PublicLeagueSummary } from "./contract";

const ANY = MATCHMAKING_CONFIG.anyValue;

/** Nothing narrowed: what browse answers with before anybody touches a control. */
export const EMPTY_BROWSE_FILTER: BrowseFilter = { format: ANY, experienceTier: ANY, stakeTier: ANY };

/**
 * Turns whatever arrived on a query string into a filter the rest of the system can trust.
 *
 * Unknown, misspelled and hostile values all normalize to "any" rather than erroring. Browse is
 * a public read reached by hand-edited URLs, shared links and stale bookmarks, and the honest
 * answer to `?format=dynasty` is the unfiltered list of leagues we CAN offer, not a 400 that
 * teaches a visitor nothing. This is the only place a raw string becomes a `BrowseFilter`.
 */
export function normalizeBrowseFilter(raw: {
  readonly format?: string | null;
  readonly experienceTier?: string | null;
  readonly stakeTier?: string | null;
}): BrowseFilter {
  const stake = Number(raw.stakeTier);
  const stakeIsConfigured =
    raw.stakeTier !== undefined &&
    raw.stakeTier !== null &&
    raw.stakeTier !== "" &&
    Number.isInteger(stake) &&
    MATCHMAKING_CONFIG.stakeTiers.some((entry) => entry.tier === stake);

  return {
    format: MATCHMAKING_CONFIG.formats.find((value) => value === raw.format) ?? ANY,
    experienceTier: MATCHMAKING_CONFIG.experienceTiers.find((value) => value === raw.experienceTier) ?? ANY,
    stakeTier: stakeIsConfigured ? stake : ANY,
  };
}

/** True when a league matches every narrowed field. The one filter rule in the product. */
export function matchesBrowseFilter(league: PublicLeagueSummary, filter: BrowseFilter): boolean {
  if (filter.format !== ANY && league.format !== filter.format) return false;
  if (filter.experienceTier !== ANY && league.experienceTier !== filter.experienceTier) return false;
  if (filter.stakeTier !== ANY && league.stakeTier !== filter.stakeTier) return false;
  return true;
}

/**
 * A league is browsable and joinable only while it has a seat left. Shared by the browse read
 * and the join, so a card that says "join" and a POST that accepts it agree by construction.
 */
export function hasOpenSeat(league: Pick<PublicLeagueSummary, "teamCount" | "filledTeams">): boolean {
  return league.filledTeams < league.teamCount;
}

/** The human label for a cosmetic stake tier. Never an amount of money. */
export function stakeTierLabel(tier: number): string {
  return MATCHMAKING_CONFIG.stakeTiers.find((entry) => entry.tier === tier)?.label ?? MATCHMAKING_CONFIG.stakeTiers[0].label;
}
