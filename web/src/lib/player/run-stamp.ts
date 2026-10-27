/** The player page's run stamp in the member's zone (Lane 234, ruling 2), loaded after first paint.
 * A module of its own that the page imports whole: importing the front door's board and the clock
 * directly would make the shared chunk build their namespaces, and every page load that helper. */
import { memberZone } from '#lib/format/clock.ts';
import { inSeasonStamp } from '#lib/front/live-board.ts';

/** The run's stamp in the member's zone, null before the season or on a run that says no refresh. */
export function memberRunStamp(format: Parameters<typeof inSeasonStamp>[0]): string | null {
	return inSeasonStamp(format, memberZone())?.text ?? null;
}
