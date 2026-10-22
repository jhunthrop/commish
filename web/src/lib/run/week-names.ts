/** The Players page's names (Lane 142, ruling 1). In season the page is the week's rankings, one
 * name on every surface that points to it: the rail (a league followed or not), the bar's crumb after
 * Players, the front card's link and its table's rank head. Before the season and after it, the page
 * is Players. The form is keyed by the site's season at the page's clock (site-season.ts) and the
 * week the run ranks from; the server builds the words with the page, so no page's script carries
 * them. */
import {
	WEEK_RANKINGS_KEY,
	railInSeason,
	weekRankingsWord,
	type RailItem,
	type RailKey
} from '#lib/ui/nav.ts';

/** Both forms' words, in one place for the copy guard. */
export const PAGE_NAME_WORDS = {
	/** The page's name before the season, and the crumb's root in season. */
	players: 'Players',
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

/** The in-season names at a rail and a run's week; null before the season, after it, and on a run
 * that ranks from no week. */
export function weekNames(rail: RailKey, week: number | undefined): WeekNames | null {
	if (!railInSeason(rail) || week === undefined) return null;
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
