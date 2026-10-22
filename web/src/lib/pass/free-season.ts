/** Whether the site is in its free season (the founder's 2026-10-22 ruling: the 2026 season is free,
 * paid tiers return later). The API's `free_season` on /billing/plans (Lane 149, the one setting the
 * founder turns) wins whenever the API answers it, true or false (Lane 150 fix round 1). Only while
 * it is absent, an API before Lane 149 or a read that failed, the web's own clock rule says it: free
 * until the season's end, the same end a season's pass had (the API's season.End(2026), March 1
 * after it). Every caller hands in its clock. */

/** The free season's end: the API's season.End(2026). */
export const FREE_SEASON_ENDS = '2027-03-01T00:00:00Z';
const FREE_SEASON_ENDS_MS = Date.parse(FREE_SEASON_ENDS);

/** The site's free season at an instant: the API's flag when it has one, else before the end. */
export function freeSeasonAt(now: Date, flag?: boolean): boolean {
	return flag ?? now.getTime() < FREE_SEASON_ENDS_MS;
}

/** The free season as the page and the account page read it: the catalog's flag through
 * freeSeasonAt, the clock rule alone when the read fails. */
export async function readFreeSeason(plans: () => Promise<unknown>, now: Date): Promise<boolean> {
	try {
		return freeSeasonAt(now, freeSeasonFlag(await plans()));
	} catch {
		return freeSeasonAt(now);
	}
}

/** The API's `free_season` from a /billing/plans answer, undefined when the answer has none (an API
 * before Lane 149) or it is not a boolean. */
export function freeSeasonFlag(plans: unknown): boolean | undefined {
	if (typeof plans !== 'object' || plans === null || !('free_season' in plans)) return undefined;
	const flag = plans.free_season;
	return typeof flag === 'boolean' ? flag : undefined;
}
