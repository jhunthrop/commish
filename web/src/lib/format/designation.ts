/** A player's injury designation in words, one vocabulary for every screen (Lane 63): the league
 * screens' week mark, and the board and player pages' status. The statuses are the API's
 * (`DesignationStatus`) and the run's (`designations.json`). */
import type { components } from '#lib/api/types.ts';
import {
	memberZone,
	monthDay,
	sameDay,
	shortDay,
	stampAt,
	timeOfDay,
	weekdayTime,
	zoneShort
} from './clock.ts';

export type DesignationStatus = components['schemas']['DesignationStatus'];

export const DESIGNATION_WORDS: Readonly<Record<DesignationStatus, string>> = {
	questionable: 'Questionable',
	doubtful: 'Doubtful',
	out: 'Out',
	injured_reserve: 'On injured reserve',
	suspended: 'Suspended',
	pup: 'On the PUP list',
	nfi: 'On the NFI list'
};

/** The status as the rank cell prints it for a player on a season-long list: "IR". */
export const RANK_WORDS: Readonly<Record<DesignationStatus, string>> = {
	questionable: 'Q',
	doubtful: 'D',
	out: 'Out',
	injured_reserve: 'IR',
	suspended: 'Susp',
	pup: 'PUP',
	nfi: 'NFI'
};

/** "On injured reserve", "Doubtful": the status at the head of a sentence. */
export function designationWord(status: DesignationStatus): string {
	return DESIGNATION_WORDS[status];
}

/** "IR", "PUP": the status in the few characters a rank has. */
export function rankWord(status: DesignationStatus): string {
	return RANK_WORDS[status];
}

/** The statuses that are season-long by themselves (Lane 128 fix round 1), the API's list
 * (boards.SeasonLong): an out is season-long only when the API or the capture says so (its note says
 * out for the season), which `season_long` and `seasonLong` carry. The one list every web surface
 * reads. */
export const SEASON_LONG_STATUSES: ReadonlySet<DesignationStatus> = new Set([
	'injured_reserve',
	'pup',
	'nfi',
	'suspended'
]);

/** Whether a status keeps him off the field for weeks: by itself, or as the API flags it. */
export function seasonLongStatus(status: DesignationStatus, flagged = false): boolean {
	return flagged || SEASON_LONG_STATUSES.has(status);
}

/** A list's words where a figure of his week would be, by its short form, where "On" and the short
 * form do not read. */
const ON_LIST_WORDS: Readonly<Record<string, string>> = { Out: 'Out for the season' };

/** "On IR", "On Susp", "Out for the season": a listed player's word where a figure of his week would
 * be (Lane 128): his week tiles, and the order's verb cell for a free agent Waivers does not hold. */
export function onListWords(word: string): string {
	return ON_LIST_WORDS[word] ?? `On ${word}`;
}

/** "Questionable as of Thu 4:10 pm": the designation with when the report said so. */
export function designationMark(
	status: DesignationStatus,
	asOf: string,
	zone: string = memberZone()
): string {
	return `${DESIGNATION_WORDS[status]} as of ${weekdayTime(asOf, zone)}`;
}

/** Whether a designation keeps him out (out, injured reserve, suspended, PUP, NFI): drawn as a loss. */
export function sitsHim(status: DesignationStatus): boolean {
	return status !== 'questionable' && status !== 'doubtful';
}

/** A season-long status as a board row and a player page say it, with what the order does with it:
 * "On injured reserve since October 14. Our rest-of-season figure assumes he plays, so he sits below
 * the available players." A run whose start we do not know says when the capture listed him. */
export function seasonLongLine(
	status: { status: DesignationStatus; since: string | null },
	readAt: string,
	restOfSeason: boolean,
	zone: string = memberZone()
): string {
	const figure = restOfSeason ? 'Our rest-of-season figure' : 'Our projection';
	return `${listedSince(status, readAt, zone)}. ${figure} assumes he plays, so he sits below the available players.`;
}

/** A kicker's or a defense's season-long status, who carries no figure of ours (Lane 66m): "On injured
 * reserve since October 14, so he sits below the available players." */
export function draftOrderLongLine(
	status: { status: DesignationStatus; since: string | null },
	readAt: string,
	zone: string = memberZone()
): string {
	return `${listedSince(status, readAt, zone)}, so he sits below the available players.`;
}

/** "On injured reserve since October 14", or as of the capture when we do not know the start. */
function listedSince(
	status: { status: DesignationStatus; since: string | null },
	readAt: string,
	zone: string
): string {
	const when =
		status.since === null
			? `as of ${monthDay(readAt, zone)}`
			: `since ${monthDay(status.since, zone)}`;
	return `${DESIGNATION_WORDS[status.status]} ${when}`;
}

/** The capture a page's statuses come from: when its list last changed, and the capture job's last
 * successful check of it (null when the store records none). */
export interface CaptureStamp {
	readAt: string;
	checkedAt: string | null;
}

/** Past this long since the check the statuses come from, the basis says how old they are. They stay
 * applied: a player on injured reserve ranked as if he plays would be worse than a stale notice. */
export const CAPTURE_BEHIND_MS = 36 * 60 * 60 * 1000;

/** "Tue Oct 13, 9:03 pm CT": a stamp a static page may print a week or more later, so it names the
 * month and the day, in the site's one stamp format (clock.ts stampAt, Lane 139, C12). */
export function stampWords(iso: string, zone: string = memberZone()): string {
	return stampAt(iso, zone);
}

/** The capture's few words on a board's basis, shared with the apps (shared/words/capture.json). */
export const CAPTURE_WORDS = {
	status: 'Status',
	read: 'read',
	asOf: 'as of',
	today: 'today',
	old: 'over 36 hours ago'
} as const;

/** When a capture was last known to stand: its check, else its list's last change. */
function captureLast(capture: CaptureStamp): number {
	return Date.parse(capture.checkedAt ?? capture.readAt);
}

/** The capture a board's status column is as of (Lane 280, B257), one rule for the web and the apps:
 * the newer of the run's capture and the live order's (its answer's status_read), which carries the
 * hourly capture that landed since the run; the run's on a tie, either alone when the other is none. */
export function newerCapture(
	run: CaptureStamp | null,
	live: CaptureStamp | null
): CaptureStamp | null {
	if (live === null || run === null) return live ?? run;
	return captureLast(live) > captureLast(run) ? live : run;
}

/** The capture in the few words a page of board rows has left in its five-line basis (Lane 66n):
 * "Status read Oct 16.", "as of" its last change with no check, the hour on the member's own day
 * ("Status read today 9:15 am CT."), and past CAPTURE_BEHIND_MS how old it is. The player page keeps captureLine's fuller words. */
export function captureShort(
	capture: CaptureStamp,
	now: number,
	zone: string = memberZone()
): string {
	// On the member's own day the hour tells this hour's capture from last night's (Lane 280).
	const stamp = (iso: string): string =>
		sameDay(new Date(iso), new Date(now), zone)
			? `${CAPTURE_WORDS.today} ${timeOfDay(iso, zone)} ${zoneShort(iso, zone)}`
			: shortDay(iso, zone);
	const when =
		capture.checkedAt === null
			? `${CAPTURE_WORDS.asOf} ${stamp(capture.readAt)}`
			: `${CAPTURE_WORDS.read} ${stamp(capture.checkedAt)}`;
	const old = now - captureLast(capture) > CAPTURE_BEHIND_MS ? `, ${CAPTURE_WORDS.old}` : '';
	return `${CAPTURE_WORDS.status} ${when}${old}.`;
}

/** The basis line's sentence naming the capture and when it was read, "read" only for a real check:
 * "Injury status from the hourly capture, read Fri Oct 16, 9:05 am Central.", else "as the list
 * stood" at its last change. Past CAPTURE_BEHIND_MS since the last check (or the list, with none) it
 * says how old the statuses are, never that the capture is behind: a static page judges that against
 * the file it was built from, which may be older than the capture itself. */
export function captureLine(
	capture: CaptureStamp,
	now: number,
	zone: string = memberZone()
): string {
	const last = capture.checkedAt ?? capture.readAt;
	const when =
		capture.checkedAt === null
			? `as the list stood ${stampWords(capture.readAt, zone)}`
			: `read ${stampWords(capture.checkedAt, zone)}`;
	if (now - Date.parse(last) > CAPTURE_BEHIND_MS) {
		return `These injury statuses are from the hourly capture, ${when}, over a day and a half before now. Players keep them until a newer list is read.`;
	}
	return `Injury status from the hourly capture, ${when}.`;
}

/** "IR since Sep 22": a season-long status as the shared chip says it (Lane 66n), on the board, a
 * club, ADP, the player card, the order and the league rows alike, dated by when his run under it
 * began, or the word alone ("IR") when we do not know. The capture's read is never the chip's: the
 * page's basis line says it once. What the order does with him is said at the head of his section. */
export function seasonLongMark(
	status: { status: DesignationStatus; since: string | null; returning?: string | null },
	zone: string = memberZone()
): string {
	const word = RANK_WORDS[status.status];
	// On the list with a later return day (Lane 153): "IR, back Nov 8".
	if (status.returning) return `${word}, back ${calendarDay(status.returning)}`;
	return status.since === null ? word : `${word} since ${shortDay(status.since, zone)}`;
}

/** "Nov 8", with its weekday "Sun Oct 25": the provider's return day (an ISO day), the same day on
 * every clock. */
export function calendarDay(day: string, weekday = false): string {
	const noon = `${day}T12:00:00Z`;
	return `${weekday ? weekdayTime(noon, 'UTC').slice(0, 4) : ''}${shortDay(noon, 'UTC')}`;
}

/** "Due back Sun Oct 25": a player due back this week, his pill's word (Lane 153). The API and the capture
 * send a return day on a week's designation only when he is designated to return by his own club's game
 * day this week, his club the board's (Lane 153 fix round 1, Lane 160): this week's question, ranked as
 * playing. */
export function returningMark(returning: string): string {
	return `Due back ${calendarDay(returning, true)}`;
}
