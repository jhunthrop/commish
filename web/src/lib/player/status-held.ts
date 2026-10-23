/** A week read written before his designation changed (Lane 162, D01): withheld as the run withholds a
 * read whose status moved (`nightly/build/pages.py week_read_json`), behind the run's words for it.
 *
 * The run judges the read against the status it serves at its build; the injury capture beside it
 * (`designations.json`) is written again every hour (`nightly/designations.py mark_runs`), and the hourly
 * web build that follows it keeps the night's read. So a player due back this week (Lane 153: questionable
 * with `returning`) whose read was written while he was on the list kept a read saying he does not play.
 * The page and the shelf (its card, cardData) both take his read from the player page's build, so this is
 * the one place the rule is read.
 *
 * The rewrite: the writer's hourly pass queues the read (`capsules/week/cadence.py due_reason`,
 * STATUS_CHANGED, his stored status against the week sheet's, read through the same status read with the
 * return rule), and the week sheet's rules refuse a read that keeps a returning player out
 * (`capsules/week/rules.py _returning_violations`). Built on the server: the page's script carries none
 * of it. */
import { stampAt } from '#lib/format/clock.ts';
import type { Designations, PlayerStatus, WeekRead } from '#lib/run/schema.ts';

/** The zone the read's captions are said in, as the run says them (`capsules/week/sheet.py CENTRAL`). */
const CAPTION_ZONE = 'America/Chicago';
/** The writer's hourly passes, Eastern hours (`capsules/week/caption.py HOURLY_PASS_HOURS_ET`, the
 * capture's schedule in `infra/research-schedule.sh`): midnight, 2 am, then 6 am through 11 pm. */
const HOURLY_PASS_HOURS_ET: ReadonlySet<number> = new Set([
	0, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
]);
const PASS_ZONE = 'America/New_York';
const HOUR_MS = 3_600_000;
/** A day of hours and one more: every day holds a pass, so the search ends within it. */
const HOURS_SEARCHED = 48;

export const STATUS_HELD_WORDS = {
	/** The run's caption for a read his status moved past (`caption.py status_changed_caption`). */
	changed: (due: string): string =>
		`His status changed since this read was written. A new read is due by ${due}.`
} as const;

const passHour = new Intl.DateTimeFormat('en-US', {
	timeZone: PASS_ZONE,
	hour: 'numeric',
	hourCycle: 'h23'
});

/** The first hourly pass strictly after `after` (ms): on the hour, as every Eastern hour is a UTC one. */
export function nextHourlyPass(after: number): number {
	let at = Math.floor(after / HOUR_MS) * HOUR_MS + HOUR_MS;
	for (let step = 0; step < HOURS_SEARCHED; step++, at += HOUR_MS) {
		if (HOURLY_PASS_HOURS_ET.has(Number(passHour.format(at)))) return at;
	}
	throw new Error('Every day holds an hourly pass.');
}

/** When the capture was last read: its check, else its stamp (the page's "read" instant). */
function lastRead(capture: Pick<Designations, 'readAt' | 'checkedAt'>): number {
	return Date.parse(capture.checkedAt ?? capture.readAt);
}

/** Whether his designation changed since the read was written. Only a capture read after the write can
 * say so (one read before it is the list the writer read, or an older one); then another status than
 * the one the read was written against (a player due back this week reads questionable where the read
 * says IR), or the same status in a run that began after the read (`since`, the first capture of his
 * unbroken run), is a change. */
export function statusChangedSince(
	read: WeekRead,
	capture: Pick<Designations, 'readAt' | 'checkedAt'>,
	listed: PlayerStatus | undefined
): boolean {
	const written = Date.parse(read.writtenAt);
	if (lastRead(capture) <= written) return false;
	if (read.status !== (listed?.status ?? null)) return true;
	return listed?.since != null && Date.parse(listed.since) > written;
}

/** His read as the page and the shelf are built with it at `now` (ms): withheld behind the status
 * caption and the next hourly pass when his designation changed since it was written; as the run
 * served it otherwise, and with no capture to judge it by. */
export function readAtStatus(
	read: WeekRead,
	capture: Designations | null,
	playerId: string,
	now: number
): WeekRead {
	if (capture === null || !statusChangedSince(read, capture, capture.players[playerId]))
		return read;
	const due = new Date(nextHourlyPass(now)).toISOString();
	return {
		...read,
		body: null,
		call: null,
		caption: STATUS_HELD_WORDS.changed(stampAt(due, CAPTION_ZONE))
	};
}
