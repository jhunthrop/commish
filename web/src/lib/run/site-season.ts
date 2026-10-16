/** The site's own season at build, for a visitor with no league selected (spec 2026-10-16 §1): the
 * run's kickoffs place the build's clock on the API's own boundaries (api season SiteAt). Week 1's
 * first kickoff to the end of the last regular-season game day on the Eastern clock is the season,
 * the NFL's playoffs follow to the end of Super Bowl day (five weeks after the last game day, the
 * schedule the run carries holding no postseason), then the offseason until the next season's run,
 * and before week 1 the preseason. The build runs hourly, and /me or GET /season corrects it. */
import { railKey, railPhase, type RailKey, type SitePhase } from '#lib/ui/nav.ts';

const EASTERN = 'America/New_York';
/** Wild card, divisional, conference, the bye, then the Super Bowl: five weeks of days. */
const SUPER_BOWL_AFTER_LAST_GAME_DAYS = 35;
const HOUR_MS = 3_600_000;
/** The Eastern clock's offsets from UTC, standard and daylight. */
const EASTERN_OFFSETS_H = [5, 4] as const;

const easternDate = new Intl.DateTimeFormat('en-CA', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	timeZone: EASTERN
});
const easternTime = new Intl.DateTimeFormat('en-US', {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZone: EASTERN
});

/** An instant's calendar day on the Eastern clock, as [year, month, day]. */
function easternDay(time: number): [number, number, number] {
	const [year = 0, month = 0, day = 0] = easternDate.format(time).split('-').map(Number);
	return [year, month, day];
}

/** The midnight that starts a calendar day on the Eastern clock, `days` after the given one. */
function easternMidnight([year, month, day]: [number, number, number], days: number): number {
	for (const offset of EASTERN_OFFSETS_H) {
		const at = Date.UTC(year, month - 1, day + days) + offset * HOUR_MS;
		if (easternTime.format(at) === '00:00') return at;
	}
	throw new Error(`No Eastern midnight on ${String(year)}-${String(month)}-${String(day + days)}.`);
}

export function siteSeason(now: Date, kickoffs: readonly string[]): SitePhase {
	if (kickoffs.length === 0) throw new Error('The run has no kickoffs to place the season by.');
	const times = kickoffs.map((kickoff) => Date.parse(kickoff));
	const lastGameDay = easternDay(Math.max(...times));
	const regularEnd = easternMidnight(lastGameDay, 1);
	const superBowlEnd = easternMidnight(lastGameDay, SUPER_BOWL_AFTER_LAST_GAME_DAYS + 1);
	const clock = now.getTime();
	if (clock < Math.min(...times)) return 'preseason';
	if (clock < regularEnd) return 'in_season';
	return clock < superBowlEnd ? 'playoffs' : 'offseason';
}

/** The rail the site's season shows at an instant, with no league selected. */
export function siteRailAt(now: Date, kickoffs: readonly string[]): RailKey {
	return railKey(railPhase(null, siteSeason(now, kickoffs)));
}
