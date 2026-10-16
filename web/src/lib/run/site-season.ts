/** The site's own season at build, for a visitor with no league selected (spec 2026-10-16 §1): the
 * run's kickoffs place the build's clock. Week 1's first kickoff to the night of the last
 * regular-season game is the season, the NFL's playoffs follow, then the offseason until the next
 * season's run, and before week 1 the preseason. The build runs hourly, so the static rail is never
 * more than an hour behind the calendar, and a signed-in visitor's /me season corrects it. */
import type { SitePhase } from '#lib/ui/nav.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The last regular-season game is still on through the night it kicks off. */
const LAST_GAME_MS = 12 * HOUR_MS;
/** The NFL's playoffs: the wild card weekend to the Super Bowl, five weeks after the last
 * regular-season Sunday with the week off before it, and the night of the game. */
const PLAYOFFS_MS = 36 * DAY_MS;

export function siteSeason(now: Date, kickoffs: readonly string[]): SitePhase {
	if (kickoffs.length === 0) throw new Error('The run has no kickoffs to place the season by.');
	const times = kickoffs.map((kickoff) => Date.parse(kickoff));
	const first = Math.min(...times);
	const seasonEnds = Math.max(...times) + LAST_GAME_MS;
	const clock = now.getTime();
	if (clock < first) return 'preseason';
	if (clock <= seasonEnds) return 'in_season';
	return clock <= seasonEnds + PLAYOFFS_MS ? 'playoffs' : 'offseason';
}
