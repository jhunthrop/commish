/** A stamp with its day, its time and its zone (Lane 140), apart from clock.ts so the pages that never
 * print one (the player page) do not carry it in their shared clock chunk. */
import { shortDay, timeOfDay, weekdayTime, zoneWord } from './clock.ts';

/** The clock a prerendered page says the run's times on, before the page knows the reader's. */
export const BUILD_ZONE = 'America/Chicago';

/** "Thu Oct 22, 2:38 am Central": the one form a screen's run or set time takes (C14, C24). */
export function dayTimeStamp(iso: string, zone: string): string {
	const [weekday = ''] = weekdayTime(iso, zone).split(' ');
	return `${weekday} ${shortDay(iso, zone)}, ${timeOfDay(iso, zone)} ${zoneWord(zone)}`;
}
