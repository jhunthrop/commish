import { NFL_TEAM_ABBREVIATIONS } from "@research-ts/projections/capture-feeds";
import { productTeamCode } from "@research-ts/projections/nflverse/team-codes";
import { TEAM_PAGE_CONFIG } from "./config";

/**
 * ONE CANONICAL URL PER CLUB (coordinator's ruling): the product's own spelling. The other
 * spelling of the two clubs the feeds disagree about (`LA` for `LAR`, `WAS` for `WSH`), and the
 * three historical cities nflverse's files still carry (`STL`, `SD`, `OAK`), resolve through
 * `productTeamCode` and redirect; anything neither feed has ever used is unknown.
 */
export type TeamRoute = { readonly kind: "canonical"; readonly code: string } | { readonly kind: "redirect"; readonly code: string } | { readonly kind: "unknown" };

const PRODUCT_CODES: ReadonlySet<string> = new Set(NFL_TEAM_ABBREVIATIONS);

export function resolveTeamRoute(param: string): TeamRoute {
  const upper = param.trim().toUpperCase();
  if (PRODUCT_CODES.has(upper)) return upper === param ? { kind: "canonical", code: upper } : { kind: "redirect", code: upper };
  try {
    return { kind: "redirect", code: productTeamCode(upper) };
  } catch {
    return { kind: "unknown" };
  }
}

export function teamPagePath(code: string): string {
  return `${TEAM_PAGE_CONFIG.routeBase}/${code}`;
}
