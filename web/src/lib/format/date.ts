/** Dates as the site prints them, always in US Eastern time, the clock the NFL keeps. */

const ZONE = 'America/New_York';

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: ZONE });
const DAY_TIME = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
	timeZone: ZONE,
	timeZoneName: 'short'
});

function parse(iso: string): Date {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) throw new RangeError(`"${iso}" is not a date.`);
	return date;
}

/** "Oct 12". */
export function dayLabel(iso: string): string {
	return DAY.format(parse(iso));
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: ZONE });

/** "Thu Oct 15": a day ahead, where the weekday is how a drafter places it. */
export function weekdayLabel(iso: string): string {
	return `${WEEKDAY.format(parse(iso))} ${dayLabel(iso)}`;
}

/** "Oct 12, 1:00 AM EDT". */
export function dayTimeLabel(iso: string): string {
	return DAY_TIME.format(parse(iso));
}

/** "Sep 5 to Sep 9", or "Sep 7" when a window opens and closes on one day. */
export function windowLabel(window: { from: string; to: string }): string {
	const from = dayLabel(window.from);
	const to = dayLabel(window.to);
	return from === to ? from : `${from} to ${to}`;
}

const LOCAL_TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** "9:41 PM" on the reader's own clock: the time something happened in front of them, like a
 * save, rather than a time the league keeps. */
export function localTimeLabel(date: Date): string {
	return LOCAL_TIME.format(date);
}
