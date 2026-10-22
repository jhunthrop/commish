/** The Players page's names (Lane 142, ruling 1). In season the page is the week's rankings, one
 * name on every surface that points to it: the rail (a league followed or not), the bar's crumb after
 * Players, the front card's link and its table's rank head. Before the season and after it, the page
 * is Players. The form is keyed by the site's season at the page's clock (site-season.ts) and the
 * week the run ranks from; the server builds the words with the page, so no page's script carries
 * them. */
import {
	PLAYERS_NAME,
	WEEK_RANKINGS_KEY,
	weekRankingsWord,
	type RailItem,
	type RailKey
} from '#lib/ui/nav.ts';

/** The one site rail whose pages name the week: the regular season, the run's kickoffs placing it
 * (site-season.ts). The site's playoffs rail is the NFL's postseason, after the schedule's last game. */
const SITE_RANKS_WEEKS: RailKey = 'in_season';

/** Both forms' words, in one place for the copy guard. */
export const PAGE_NAME_WORDS = {
	/** The page's name before the season, and the crumb's root in season. */
	players: PLAYERS_NAME,
	/** The page's name in season: the rail's item, the front card's link, the page's head. */
	rankings: weekRankingsWord,
	/** The rank column's head in season: our order as set for the week. */
	rank: (week: number) => `Week ${String(week)} rank`,
	/** The bar's crumb, its steps as Crumb separates them. */
	crumb: (root: string, page: string) => `${root} / ${page}`
} as const;

/** The page's in-season names. */
export interface WeekNames {
	/** "Week 7 rankings". */
	rankings: string;
	/** "Week 7 rank". */
	rank: string;
}

/** The in-season names at the site's rail (siteRailAt, the season at the page's clock, no league)
 * and a run's week; null before the season, after it, and on a run that ranks from no week. The
 * season ends with the schedule's last regular-season game day (Lane 143, B126): the fantasy playoffs
 * are weeks the run still ranks (a run that names week 18 reads "Week 18 rankings" through its last
 * game), and the NFL's postseason, the site's playoffs rail, is Players, as the API's board_week is
 * absent outside the regular season. */
export function weekNames(siteRail: RailKey, week: number | undefined): WeekNames | null {
	if (siteRail !== SITE_RANKS_WEEKS || week === undefined) return null;
	return { rankings: PAGE_NAME_WORDS.rankings(week), rank: PAGE_NAME_WORDS.rank(week) };
}

/** A rail item's label as the shell draws it, for the shots: the week's order named for the run's
 * week, its own label with none. */
export function railItemLabel(item: Pick<RailItem, 'key' | 'label'>, week: number | null): string {
	return item.key === WEEK_RANKINGS_KEY && week !== null
		? PAGE_NAME_WORDS.rankings(week)
		: item.label;
}

/** The bar's crumb on the Players page: "Players / Week 7 rankings" in season, "Players" before. */
export function playersCrumb(rankings: string | undefined): string {
	return rankings === undefined
		? PAGE_NAME_WORDS.players
		: PAGE_NAME_WORDS.crumb(PAGE_NAME_WORDS.players, rankings);
}
