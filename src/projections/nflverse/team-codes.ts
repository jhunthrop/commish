import { NFL_TEAM_ABBREVIATIONS } from "@/projections/capture-feeds";
import { TANK01_CONFIG } from "@/stats/tank01/config";

/**
 * THE ONE PLACE THE TWO TEAM SPELLINGS MEET.
 *
 * Two feeds name the same 32 clubs and disagree about exactly two of them: the product's stats
 * provider spells the Rams `LAR` and Washington `WSH` (`NFL_TEAM_ABBREVIATIONS`,
 * `capture-feeds.ts`), and nflverse spells them `LA` and `WAS` (`CURRENT_32`, `team-eras.ts`).
 * Every other code is identical on both sides. Until this module existed there was no join between
 * the two lists anywhere in the codebase, so a team-level historical fact could not be attached to
 * the defense a manager actually drafts.
 *
 * IT ALSO CARRIES THE THREE HISTORICAL SPELLINGS, IN ONE DIRECTION ONLY. nflverse's files use the
 * contemporary code (`STL` through 2015, `SD` through 2016, `OAK` through 2019 — see `team-eras.ts`
 * for the exact seasons), and the product has no spelling at all for a franchise's old city. So
 * `productTeamCode` folds them onto the current code and `sourceTeamCode` never emits one. The
 * asymmetry is deliberate rather than an oversight: a 2014 St. Louis defense row belongs to today's
 * `DST-LAR`, and there is no question in the other direction to answer.
 *
 * NO SEASON ARGUMENT, and that is safe rather than sloppy: no two franchises have ever shared an
 * abbreviation in the covered span, so a source code identifies a franchise on its own. The test
 * walks every code `nflTeamsBySeason` emits for 2013 through 2025 and asserts this module answers
 * for all of them, which is the check that would catch a relocation this file had not been told
 * about.
 *
 * MEASURED, 2026-09-05: the `stats_team` and `stats_player` releases DO NOT USE the historical
 * spellings at all. Both normalise a club to its current code in every row (the 2013 week 1 Rams
 * row reads `LA`, while the `game_id` beside it still reads `2013_01_ARI_STL`), and the two
 * ingested tables between them hold exactly the 32 current codes and nothing else. The historical
 * branch below is therefore unused by THOSE two readers and is kept because `games.csv`
 * (`schedule.ts`) and `weekly_rosters` (`roster-weeks.ts`) do carry `STL`, `SD` and `OAK`, and
 * because a mapping that silently threw on a code the archive already holds would be worse than one
 * branch nobody currently walks.
 *
 * AND IT MINTS THE SYNTHETIC UNIVERSE ID. A team defense is not a person, so nflverse publishes no
 * row for one and `nfl_players` (whose id is a gsis id) has nowhere to hang one. Every projection
 * reader joins through `player_crosswalk` and `preseason_projections` has a foreign key into
 * `nfl_players`, so the path of least surgery is one synthetic universe row per club rather than a
 * parallel projection store. The id is `team-def:<source code>` and it is minted HERE so
 * `crosswalk.ts`, the backfill script and every future reader cannot disagree about its shape.
 */

/** The prefix that marks a synthetic team-defense row in `nfl_players`. Nothing else uses it. */
export const TEAM_DEFENSE_UNIVERSE_PREFIX = "team-def:";

/** Product spelling to source spelling. Only two clubs differ; the rest are the identity. */
const PRODUCT_TO_SOURCE: Readonly<Record<string, string>> = { LAR: "LA", WSH: "WAS" };

/**
 * Source spelling to product spelling, INCLUDING the three franchises that played the early part of
 * the ingested span under a different city. See the module docblock for why this direction carries
 * the history and the other does not.
 */
const SOURCE_TO_PRODUCT: Readonly<Record<string, string>> = {
  LA: "LAR",
  WAS: "WSH",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
};

const PRODUCT_CODES: ReadonlySet<string> = new Set(NFL_TEAM_ABBREVIATIONS);

/**
 * The source's spelling for one product team code.
 *
 * THROWS on anything that is not one of the 32, rather than passing it through. A code that maps to
 * nothing would silently drop a whole club's history out of a fit, and a fit missing one team in
 * thirty two looks exactly like a fit that ran.
 */
export function sourceTeamCode(productCode: string): string {
  if (!PRODUCT_CODES.has(productCode)) {
    throw new Error(
      `${productCode} is not one of the 32 product team codes (\`NFL_TEAM_ABBREVIATIONS\`, capture-feeds.ts). ` +
        `A team code that maps to nothing would silently drop a whole club's history.`,
    );
  }
  return PRODUCT_TO_SOURCE[productCode] ?? productCode;
}

/** The product's spelling for one source team code, historical spellings included. Throws on
 *  anything neither feed uses, for the same reason `sourceTeamCode` does. */
/**
 * The key both sides of a team-week join are folded onto: season, week, and the club in the
 * PRODUCT's spelling. Folding through `productTeamCode` is what makes a relocated franchise's
 * season join at all (the schedule file says `STL`, the team stats say `LA`, both are `LAR` here)
 * instead of silently missing every one of its weeks. One definition, used by the archive's
 * ingest and by the fit's join alike.
 */
export function teamWeekKey(season: number, week: number, sourceTeam: string): string {
  return `${season}|${week}|${productTeamCode(sourceTeam)}`;
}

export function productTeamCode(sourceCode: string): string {
  const mapped = SOURCE_TO_PRODUCT[sourceCode];
  if (mapped !== undefined) return mapped;
  if (!PRODUCT_CODES.has(sourceCode)) {
    throw new Error(
      `${sourceCode} is not a team code either feed uses. nflverse's own spelling for the covered span is ` +
        `\`nflTeamsBySeason\` (team-eras.ts); a code outside it means the release changed.`,
    );
  }
  return sourceCode;
}

/** The synthetic `nfl_players.id` for one club's defense, in the SOURCE's spelling. */
export function teamDefenseUniverseId(sourceCode: string): string {
  return `${TEAM_DEFENSE_UNIVERSE_PREFIX}${sourceCode}`;
}

/**
 * The synthetic universe id for one product defense id (`DST-LAR`), or `null` for anything that is
 * not one.
 *
 * `null` rather than a throw because this is called over the whole provider roster, where a
 * non-defense id is the ordinary case and not an error at all. A `DST-` id whose team code is not
 * one of the 32 also returns `null`: that is a seed row or a club nobody has told this module
 * about, and the crosswalk records it as unmatched rather than guessing.
 */
export function teamDefenseUniverseIdForProviderId(providerId: string): string | null {
  const prefix = TANK01_CONFIG.defensePlayerIdPrefix;
  if (!providerId.startsWith(prefix)) return null;
  const productCode = providerId.slice(prefix.length);
  if (!PRODUCT_CODES.has(productCode)) return null;
  return teamDefenseUniverseId(sourceTeamCode(productCode));
}

/** All 32 synthetic ids, in the source's own spelling, sorted. What the backfill seeds. */
export function teamDefenseUniverseIds(): readonly string[] {
  return NFL_TEAM_ABBREVIATIONS.map((code) => teamDefenseUniverseId(sourceTeamCode(code))).sort();
}
