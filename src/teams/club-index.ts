import { NFL_TEAM_ABBREVIATIONS } from "@research/projections/capture-feeds";
import { NFL_TEAM_NAMES } from "@research/domain/nfl-team-names";
import { teamPagePath } from "./route";

export interface ClubIndexRow {
  /** The product's own spelling of the code — the one `resolveTeamRoute` calls canonical. */
  readonly code: string;
  readonly city: string;
  readonly nickname: string;
  /** The club's own page. Built through `teamPagePath`, never spelled again here. */
  readonly href: string;
}

/**
 * THE 32 CLUBS, IN READING ORDER. Pure, browser-safe, no database read: the club list is a
 * constant in this repo by deliberate choice (`NFL_TEAM_ABBREVIATIONS`' own docblock — the league
 * adds a team about once a decade), so the index of clubs is derived from that constant rather
 * than from a query that could answer "none" on a cold local database and render an empty page
 * that looks like a bug.
 *
 * PRODUCT CODES ONLY. `NFL_TEAM_NAMES` deliberately keys BOTH spellings of the three franchises
 * this repo disagrees with itself about (`LA`/`LAR`, `WAS`/`WSH`, `LV`/`OAK`) plus two historical
 * cities, because it exists to ground a writer's prose. Walking that map would put the Rams,
 * the Commanders and the Raiders on the shelf twice and add the Chargers in San Diego. The
 * canonical list is `NFL_TEAM_ABBREVIATIONS`, which is the same set `resolveTeamRoute` calls
 * canonical, so every row here links at a URL that serves without a redirect.
 *
 * Sorted by city, then nickname: the two New York clubs and the two Los Angeles clubs land beside
 * their own city rather than scattered by code, which is how a person scans for a club.
 */
export function clubIndex(): readonly ClubIndexRow[] {
  return NFL_TEAM_ABBREVIATIONS.map((code): ClubIndexRow => {
    const names = NFL_TEAM_NAMES[code];
    if (names === undefined) throw new Error(`No city and nickname for the product team code ${code}.`);
    return { code, city: names.city, nickname: names.nickname, href: teamPagePath(code) };
  }).toSorted((left, right) => left.city.localeCompare(right.city) || left.nickname.localeCompare(right.nickname));
}
