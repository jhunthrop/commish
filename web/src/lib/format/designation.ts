/** A player's injury designation in words, one vocabulary for every screen (Lane 63): the league
 * screens' week mark, and the board and player pages' status. The statuses are the API's
 * (`DesignationStatus`) and the run's (`designations.json`). */
import type { components } from '#lib/api/types.ts';
import { memberZone, monthDay, shortDay, weekdayTime, zoneWord } from './clock.ts';

export type DesignationStatus = components['schemas']['DesignationStatus'];

const DESIGNATION_WORDS: Readonly<Record<DesignationStatus, string>> = {
	questionable: 'Questionable',
	doubtful: 'Doubtful',
	out: 'Out',
	injured_reserve: 'On injured reserve',
	suspended: 'Suspended',
	pup: 'On the PUP list',
	nfi: 'On the NFI list'
};

/** The status as the rank cell prints it for a player on a season-long list: "IR". */
const RANK_WORDS: Readonly<Record<DesignationStatus, string>> = {
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

/** "Tue Oct 13, 9:03 pm Central": a stamp a static page may print a week or more later, so it names
 * the month and the day. */
export function stampWords(iso: string, zone: string = memberZone()): string {
	const [weekday = '', ...time] = weekdayTime(iso, zone).split(' ');
	return `${weekday} ${shortDay(iso, zone)}, ${time.join(' ')} ${zoneWord(zone)}`;
}

/** The capture in the few words a page of board rows has left in its five-line basis (Lane 66n):
 * "Status read Oct 16.", "as of" its last change with no check, and past
 * CAPTURE_BEHIND_MS how old it is. The player page and the record keep captureLine's fuller words. */
export function captureShort(
	capture: CaptureStamp,
	now: number,
	zone: string = memberZone()
): string {
	const last = capture.checkedAt ?? capture.readAt;
	const stamp = (iso: string): string => shortDay(iso, zone);
	const when =
		capture.checkedAt === null
			? `as of ${stamp(capture.readAt)}`
			: `read ${stamp(capture.checkedAt)}`;
	const old = now - Date.parse(last) > CAPTURE_BEHIND_MS ? ', over 36 hours ago' : '';
	return `Status ${when}${old}.`;
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

/** "IR since Sep 22": a season-long status as its pill's chip says it (Lane 66n), on the board, a
 * club, ADP, the player card and the league rows alike, dated by its start, or by the capture's day
 * when we do not know it. What the order does with him is said once, at the head of his section. */
export function seasonLongMark(
	status: { status: DesignationStatus; since: string | null },
	readAt: string,
	zone: string = memberZone()
): string {
	const when =
		status.since === null
			? `as of ${shortDay(readAt, zone)}`
			: `since ${shortDay(status.since, zone)}`;
	return `${RANK_WORDS[status.status]} ${when}`;
}
