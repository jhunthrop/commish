/** The offline page's words (Lane 102 fix round 1, MEDIUM-1): "run" is never the page's word. */
import { dayLabel } from '#lib/format/date.ts';

/** "You're offline, so this is the last board this device saved, updated Oct 19." */
export function offlineLead(runAt: string): string {
	return `You're offline, so this is the last board this device saved, updated ${dayLabel(runAt)}.`;
}
