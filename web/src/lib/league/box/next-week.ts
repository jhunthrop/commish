/** The week an action screen addresses (Lane 95): Waivers, Trades and the front door's roster facts
 * turn to the week after once every starter of the member's has played his game (the API's for_week
 * and chips_week, from the one game-state rule). The web prints the week the API names; an answer
 * from before the field reads as the platform's week. Every word is NEXT_WEEK's, for the copy guard.
 * Pure, tested in next-week.test.ts. */
import { shortDay, weekdayName } from '#lib/format/clock.ts';
import { designationWord } from '#lib/format/designation.ts';
import type { components } from '#lib/api/types.ts';

type InjuryDesignation = components['schemas']['InjuryDesignation'];

/** Every word the turn prints. */
export const NEXT_WEEK = {
	thisWeek: 'this week',
	/** "for week 7": the roster head's facts once they have turned. */
	forWeek: (week: number): string => `for week ${String(week)}`,
	/** "in week 7": a chip's fact once it has turned. */
	inWeek: (week: number): string => `in week ${String(week)}`,
	/** "Week 7": a column group's head on a turned page. */
	week: (week: number): string => `Week ${String(week)}`,
	/** The capture's rule, not a promise the pipeline has always kept (review MEDIUM-2). */
	arrives: (week: number, day: string): string =>
		`Week ${String(week)} projections expected ${day}.`,
	/** "Out, listed Oct 12": a listing carried over from a game already played. */
	listed: (word: string, day: string): string => `${word}, listed ${day}`,
	/** "Out, as of Oct 19": one the provider still lists with no date of its own. */
	asOf: (word: string, day: string): string => `${word}, as of ${day}`
} as const;

/** The week the page addresses: the API's for_week, else the platform's week. */
export function addressedWeek(advice: { week: number; for_week?: number }): number {
	return advice.for_week ?? advice.week;
}

/** Whether the page has turned to the week after the platform's. */
export function turnedPage(advice: { week: number; for_week?: number }): boolean {
	return addressedWeek(advice) > advice.week;
}

/** Whether the page's week Proj figures are drawn: once the week's published projection is read.
 * Before it, every row's would be "--", so the columns go and the page says when it is expected. */
export function weekProjected(advice: { projection_read_at: string | null }): boolean {
	return advice.projection_read_at !== null;
}

/** "Week 7 projections expected Thursday.", the day the API's capture time falls on the member's
 * clock; null once the projection is read or with no time to say. */
export function arrivesPart(
	advice: { projection_read_at: string | null; projection_arrives_at?: string | null },
	week: number,
	zone: string
): string | null {
	const at = advice.projection_arrives_at ?? null;
	if (advice.projection_read_at !== null || at === null) return null;
	return NEXT_WEEK.arrives(week, weekdayName(at, zone));
}

/** A week's designation as a turned page draws it once it is carried over from a game already
 * played (the API's carried_over): "Out, listed Oct 12", or "Out, as of Oct 19" when the provider's
 * listing has no date; null for any other, which keeps its plain word. Never hidden (the
 * coordinator's ruling). */
export function carriedMark(designation: InjuryDesignation | null, zone: string): string | null {
	if (designation?.carried_over !== true) return null;
	const word = designationWord(designation.status);
	const listed = designation.listed ?? null;
	return listed === null
		? NEXT_WEEK.asOf(word, shortDay(designation.as_of, zone))
		: NEXT_WEEK.listed(word, shortDay(listed, zone));
}
