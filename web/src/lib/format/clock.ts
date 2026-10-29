/** Instants on the member's own clock: the API keeps instants, a screen says them in the browser's
 * time zone and names the zone once when it is not the NFL's Eastern clock. Apart from date.ts,
 * which prints the run's dates on the Eastern clock for every reader alike. */

/** The member's own time zone, from the browser: the API keeps instants, the screen says them on the
 * member's clock. */
export function memberZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The weekday-and-time format for a zone, made once per zone. */
const weekdayFormats = new Map<string, Intl.DateTimeFormat>();

function weekdayFormat(zone: string): Intl.DateTimeFormat {
	const known = weekdayFormats.get(zone);
	if (known) return known;
	const made = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: zone
	});
	weekdayFormats.set(zone, made);
	return made;
}

/** "Sun 1:00 pm": a kickoff or a stamp on the member's clock (zoneLine names the zone once). */
export function weekdayTime(iso: string, zone: string = memberZone()): string {
	const parts = weekdayFormat(zone).formatToParts(new Date(iso));
	const part = (type: Intl.DateTimeFormatPartTypes): string =>
		parts.find((p) => p.type === type)?.value ?? '';
	return `${part('weekday')} ${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`;
}

/** The long weekday format for a zone, made once per zone. */
const weekdayNameFormats = new Map<string, Intl.DateTimeFormat>();

/** "Thursday": an instant's weekday on the member's clock, as a heading names it. */
export function weekdayName(iso: string, zone: string = memberZone()): string {
	let made = weekdayNameFormats.get(zone);
	if (!made) {
		made = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: zone });
		weekdayNameFormats.set(zone, made);
	}
	return made.format(new Date(iso));
}

/** The zone's own name, "Central Time", as the browser names it. */
export function zoneName(zone: string = memberZone()): string {
	const named = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' })
		.formatToParts(new Date())
		.find((p) => p.type === 'timeZoneName')?.value;
	return named ?? zone;
}

/** The zone in a word after a time, "9:05 am Central": a name of one word and "Time" drops the
 * "Time", any other name is said whole. */
export function zoneWord(zone: string = memberZone()): string {
	const name = zoneName(zone);
	const word = /^(\S+) Time$/.exec(name)?.[1];
	return word ?? name;
}

/** The long month-and-day format for a zone, made once per zone. */
const monthDayFormats = new Map<string, Intl.DateTimeFormat>();

/** "October 14": an instant's day on the member's clock, as a sentence names it. */
export function monthDay(iso: string, zone: string = memberZone()): string {
	let made = monthDayFormats.get(zone);
	if (!made) {
		made = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: zone });
		monthDayFormats.set(zone, made);
	}
	return made.format(new Date(iso));
}

/** The short month-and-day format for a zone, made once per zone. */
const shortDayFormats = new Map<string, Intl.DateTimeFormat>();

/** "Oct 25": an instant's day on the member's clock. */
export function shortDay(iso: string, zone: string = memberZone()): string {
	let made = shortDayFormats.get(zone);
	if (!made) {
		made = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: zone });
		shortDayFormats.set(zone, made);
	}
	return made.format(new Date(iso));
}

/** "7:00 pm": a time of day on the member's clock. */
export function timeOfDay(iso: string, zone: string = memberZone()): string {
	return weekdayTime(iso, zone).replace(/^\S+ /, '');
}

/** Whether two instants fall on the same calendar day on the member's clock. */
export function sameDay(a: Date, b: Date, zone: string = memberZone()): boolean {
	const day = (date: Date): string => date.toLocaleDateString('en-US', { timeZone: zone });
	return day(a) === day(b);
}

/** The zone's short name after a time at an instant, "CT", as the browser names it (its generic short
 * form, so it reads the same in summer and winter); the zone's id when the browser names none. */
export function zoneShort(iso: string, zone: string = memberZone()): string {
	const named = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortGeneric' })
		.formatToParts(new Date(iso))
		.find((p) => p.type === 'timeZoneName')?.value;
	return named ?? zone;
}

/** "Sun 3:25 pm CT": a kickoff with its zone, so a game time never reads as another zone's (Lane 139,
 * C11). */
export function kickoffAt(iso: string, zone: string = memberZone()): string {
	return `${weekdayTime(iso, zone)} ${zoneShort(iso, zone)}`;
}

/** "Wed Oct 21, 11:12 am CT": the player page's one stamp format (Lane 139, C12), the weekday, the
 * date and the zone, as the nightly's week read caption says its write (`capsules/week/sheet.py
 * central_stamp`). */
export function stampAt(iso: string, zone: string = memberZone()): string {
	const day = weekdayTime(iso, zone).split(' ')[0] ?? '';
	return `${day} ${shortDay(iso, zone)}, ${timeOfDay(iso, zone)} ${zoneShort(iso, zone)}`;
}
