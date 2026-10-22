/** Whether the site is in its free season (the founder's 2026-10-22 ruling: the 2026 season is free,
 * paid tiers return later). The web's own clock rule says so until the season's end, the same end a
 * season's pass had (the API's season.End(2026), March 1 after it), so the page is right before the
 * API names it. The API's `free_season` on /billing/plans (Lane 149) is read as optional: present and
 * true it says so too, absent it says nothing. Every caller hands in its clock. */

/** The free season's end: the API's season.End(2026). */
export const FREE_SEASON_ENDS = '2027-03-01T00:00:00Z';
const FREE_SEASON_ENDS_MS = Date.parse(FREE_SEASON_ENDS);

/** The site's free season at an instant: before its end, or whenever the API says so. */
export function freeSeasonAt(now: Date, flag?: boolean): boolean {
	return flag === true || now.getTime() < FREE_SEASON_ENDS_MS;
}

/** The API's `free_season` from a /billing/plans answer, undefined when the answer has none (an API
 * before Lane 149) or it is not a boolean. */
export function freeSeasonFlag(plans: unknown): boolean | undefined {
	if (typeof plans !== 'object' || plans === null || !('free_season' in plans)) return undefined;
	const flag = plans.free_season;
	return typeof flag === 'boolean' ? flag : undefined;
}
