/**
 * THE LEAGUE'S SHAPE, YEAR BY YEAR — how many teams existed, which abbreviation each franchise used,
 * and how many weeks a season ran, back to 1999.
 *
 * `validatePlayCallers` needs a ground truth for "every team-season this table must cover" that is
 * independent of the CSV it is checking — otherwise a franchise silently missing from the CSV and a
 * franchise silently missing from the truth table would agree with each other and the gap would
 * never be reported. This file is that ground truth, and it is deliberately narrow: three
 * relocations, one expansion, and the 2021 week-18 rule are the only shape changes the league has
 * had in the covered span, so those are the only branches below.
 *
 * There is no existing abbreviation constant in this codebase to reuse for this: `team-map.ts` in
 * this same directory holds line-continuity logic, not a team list, and `capture-feeds.ts`'s
 * `NFL_TEAM_ABBREVIATIONS` is Tank01's current-season spelling (`LAR`, `WSH`) with no notion of
 * history, wrong for both reasons — nflverse's own `games.csv` (which `schedule.ts` reads) spells
 * the Rams `LA` and carries the pre-relocation abbreviations `STL`/`SD`/`OAK` for the seasons they
 * played under them, and this file has to match that spelling exactly or `validatePlayCallers`
 * would flag every relocated franchise's post-move seasons as missing.
 */

/** Every season this table covers, 1999 through 2026 inclusive. */
export const FACT_SEASONS: readonly number[] = Array.from({ length: 2026 - 1999 + 1 }, (_, i) => 1999 + i);

/** The 32 teams as of their CURRENT abbreviation. Historical spellings are substituted in below. */
const CURRENT_32: readonly string[] = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
  "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",
  "TB", "TEN", "WAS",
];

/** The Texans' first season. No `HOU` row exists before this. */
const HOUSTON_EXPANSION_SEASON = 2002;

/** A franchise that played under a different abbreviation for part of the covered span. */
interface Relocation {
  /** The abbreviation used from `firstSeasonUnderCurrentName` onward. */
  readonly current: string;
  /** The abbreviation used in every season strictly before that. */
  readonly historical: string;
  /** The first season the franchise played under `current`. */
  readonly firstSeasonUnderCurrentName: number;
}

/** St. Louis through 2015, San Diego through 2016, Oakland through 2019 — see the module docblock. */
const RELOCATIONS: readonly Relocation[] = [
  { current: "LA", historical: "STL", firstSeasonUnderCurrentName: 2016 },
  { current: "LAC", historical: "SD", firstSeasonUnderCurrentName: 2017 },
  { current: "LV", historical: "OAK", firstSeasonUnderCurrentName: 2020 },
];

/** The first season with a 17-game, 18-week regular season. Every season before played 16/17. */
const SEVENTEEN_GAME_SEASON = 2021;

/**
 * Every team abbreviation that played a regular-season game in `season`, as nflverse's `games.csv`
 * would spell it — the relocated franchises under their contemporary name, and the Texans absent
 * before they existed.
 */
export function nflTeamsBySeason(season: number): readonly string[] {
  const teams = new Set(CURRENT_32);
  if (season < HOUSTON_EXPANSION_SEASON) teams.delete("HOU");
  for (const relocation of RELOCATIONS) {
    if (season < relocation.firstSeasonUnderCurrentName) {
      teams.delete(relocation.current);
      teams.add(relocation.historical);
    }
  }
  return [...teams].sort();
}

/** The last week of `season`'s regular season: 18 from 2021, 17 before. */
export function finalWeekOf(season: number): number {
  return season >= SEVENTEEN_GAME_SEASON ? 18 : 17;
}
