/** The week an action screen addresses (Lane 95): Waivers, Trades and the front door's roster facts
 * turn to the week after once every starter of the member's has played his game (the API's for_week
 * and chips_week, from the one game-state rule). The web prints the week the API names; an answer
 * from before the field reads as the platform's week. Pure, tested in next-week.test.ts. */
import { weekdayName } from '#lib/format/clock.ts';

/** The week the page addresses: the API's for_week, else the platform's week. */
export function addressedWeek(advice: { week: number; for_week?: number }): number {
	return advice.for_week ?? advice.week;
}

/** Whether the page's week Proj figures are drawn: once the week's published projection is read.
 * Before it, every row's would be "--", so the columns go and the basis says when it arrives. */
export function weekProjected(advice: { projection_read_at: string | null }): boolean {
	return advice.projection_read_at !== null;
}

/** "Week 7 projections arrive Thursday.", the day the API's capture time falls on the member's
 * clock; null once the projection is read or with no time to say. */
export function arrivesPart(
	advice: { projection_read_at: string | null; projection_arrives_at?: string | null },
	week: number,
	zone: string
): string | null {
	const at = advice.projection_arrives_at ?? null;
	if (advice.projection_read_at !== null || at === null) return null;
	return `Week ${String(week)} projections arrive ${weekdayName(at, zone)}.`;
}
