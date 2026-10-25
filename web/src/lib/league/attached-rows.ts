/** The Account room's Leagues attached table (Lane 66k): each league the member follows with its
 * team and platform, record and place, where it is in its season, and its last read, all from GET
 * /leagues/attached. Pure, tested in attached-rows.test.ts. */
import { EMPTY_FIGURE } from '#lib/format/empty.ts';
import { readWords } from '#lib/hosts/platform-rows.ts';
import type { AttachedLeague } from './api.ts';
import { placeWords, recordWords } from './model.ts';
import { hostWords } from './names.ts';
import { phaseWord } from './phase-words.ts';

export interface AttachedRow {
	id: string;
	name: string;
	/** "McConkey Kong Country, on Sleeper". */
	team: string;
	/** "1-4", "--" before a read. */
	record: string;
	/** "12th of 12", empty before a read. */
	place: string;
	/** "In season, playoffs from week 15", "Playoffs", "Season over", "Draft Mon 7:00 pm". */
	season: string;
	read: string;
}

/** Every word the table prints that is not a league's, for the copy guard. */
export const ATTACHED_WORDS = {
	title: 'Leagues attached',
	league: 'League',
	record: 'Record',
	season: 'Season',
	lastRead: 'Last read',
	inSeason: 'In season',
	/** The table's verbs and states (Lane 198, read by the apps as well). */
	open: 'Open',
	detach: 'Detach',
	detaching: 'Detaching',
	detached: 'Detached.',
	undo: 'Undo',
	unread: "Your leagues can't be read right now.",
	none: 'No leagues yet',
	newestFirst: 'newest first'
} as const;

/** The table head's count: "3, newest first". */
export function attachedCount(count: number): string {
	return `${String(count)}, ${ATTACHED_WORDS.newestFirst}`;
}

function seasonWords(league: AttachedLeague, now: Date, zone: string | undefined): string {
	if (league.phase !== 'in_season') return phaseWord(league, now, zone);
	const from = league.playoff_start_week;
	return from === null
		? ATTACHED_WORDS.inSeason
		: `${ATTACHED_WORDS.inSeason}, playoffs from week ${String(from)}`;
}

export function attachedRow(league: AttachedLeague, now: Date, zone?: string): AttachedRow {
	const s = league.standing;
	return {
		id: league.id,
		name: league.name,
		team: [league.team_name, `on ${hostWords(league.host)}`].filter((p) => p !== '').join(', '),
		record: s ? recordWords(s) : EMPTY_FIGURE,
		place: s ? placeWords(s.place, s.teams) : '',
		season: seasonWords(league, now, zone),
		read: readWords(league.last_read_at, now)
	};
}
