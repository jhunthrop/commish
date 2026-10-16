/** A player's injury designation in words, one vocabulary for every screen (Lane 63): the league
 * screens' week mark, and the board and player pages' status. The statuses are the API's
 * (`DesignationStatus`) and the run's (`designations.json`). */
import type { components } from '#lib/api/types.ts';
import { memberZone, monthDay, weekdayTime, zoneWord } from './clock.ts';

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
	const when =
		status.since === null
			? `as of ${monthDay(readAt, zone)}`
			: `since ${monthDay(status.since, zone)}`;
	const figure = restOfSeason ? 'Our rest-of-season figure' : 'Our projection';
	return `${DESIGNATION_WORDS[status.status]} ${when}. ${figure} assumes he plays, so he sits below the available players.`;
}

/** The basis line's sentence naming where the statuses come from and when they were read:
 * "Injury status from the hourly capture, read Thu 9:05 am Central." */
export function captureLine(readAt: string, zone: string = memberZone()): string {
	return `Injury status from the hourly capture, read ${weekdayTime(readAt, zone)} ${zoneWord(zone)}.`;
}
