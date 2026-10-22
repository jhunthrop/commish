/** The Players page's in-season names at the build's clock (Lane 142, ruling 1), for every
 * prerendered page: the run's pages carry them in the run stamp, and the user pages whose shell is
 * prerendered (account, sheet, pass) name the rail's week item with them, so it is named on the first
 * paint and never renamed once the context answers (Lane 143, B126). */
import { weekNames, type WeekNames } from '#lib/run/week-names.ts';
import { buildInstant } from './build-clock.ts';
import { stamp } from './run.ts';
import { buildSiteRail } from './site-rail.ts';

export async function buildWeekNames(): Promise<WeekNames | null> {
	const [run, siteRail] = await Promise.all([stamp(), buildSiteRail(new Date(buildInstant()))]);
	return weekNames(siteRail, run.week);
}

/** A prerendered user page's data: the rail's week item, named at build, absent outside the season. */
export async function buildWeekLabel(): Promise<{ weekLabel: string | undefined }> {
	return { weekLabel: (await buildWeekNames())?.rankings };
}
