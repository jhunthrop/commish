// The stand-in API's answer to the kickers' and defenses' week (Lane 66w), from week-order.ts's two
// states: before the projection's read time on the fixture's clock the week is not read yet. Without a
// league the rows carry no roster, no move and no read (api week_order.go); in an ESPN stand-in league
// each row is named by ESPN's id (a defense by its D/ST id, api hostIDOfAdd) and the claim is open.
import type { components } from '../../src/lib/api/types.ts';
import { uncountedOf } from './week.ts';

type WeekOrderAdvice = components['schemas']['WeekOrderAdvice'];
type WaiverMoves = components['schemas']['WaiverMoves'];
type Position = WeekOrderAdvice['position'];

/** A tab's answer as week-order.ts writes it: the rules sentence is the reader's, set here. */
type StoredAdvice = Omit<WeekOrderAdvice, 'basis_note'>;

/** The week's two states, as week-order.ts writes them. */
export interface WeekOrderStates {
	read: Readonly<Record<Position, StoredAdvice>>;
	unread: Readonly<Record<Position, StoredAdvice>>;
}

/** The recorded league's rules each tab's Avg and Last miss (api week_order.go uncountedRulesAt): the
 * two kicking ones, the two defense ones. */
const UNCOUNTED_RULES: Readonly<Record<Position, readonly string[]>> = {
	K: ['missed field goals', 'missed extra points'],
	DEF: ['fumble recoveries', 'safeties']
};

/** ESPN's proTeamId by our club code (api espn proTeams): a D/ST's id is -(16000 + it). */
const ESPN_PRO_TEAMS: Readonly<Record<string, number>> = {
	ATL: 1,
	BUF: 2,
	CHI: 3,
	CIN: 4,
	CLE: 5,
	DAL: 6,
	DEN: 7,
	DET: 8,
	GB: 9,
	TEN: 10,
	IND: 11,
	KC: 12,
	LV: 13,
	LAR: 14,
	MIA: 15,
	MIN: 16,
	NE: 17,
	NO: 18,
	NYG: 19,
	NYJ: 20,
	PHI: 21,
	ARI: 22,
	PIT: 23,
	LAC: 24,
	SF: 25,
	SEA: 26,
	TB: 27,
	WSH: 28,
	CAR: 29,
	JAX: 30,
	BAL: 33,
	HOU: 34
};
const DEFENSE_BASE = 16000;

/** ESPN's D/ST id for a club, "" for one ESPN does not name. */
export function espnDefenseId(club: string): string {
	const team = ESPN_PRO_TEAMS[club];
	return team === undefined ? '' : String(-(DEFENSE_BASE + team));
}

/** The position asked for, null for one the route refuses. */
export function weekPosition(params: URLSearchParams): Position | null {
	const asked = params.get('position');
	return asked === 'K' || asked === 'DEF' ? asked : null;
}

/** Where the league is read from: ESPN's stand-in with its claim open, or the recorded league. */
export interface WeekLeague {
	espn: boolean;
	moves: WaiverMoves;
	readAt: string;
}

const ESPN_CLAIM: WaiverMoves = {
	claim: 'available',
	note: null,
	takes_writes: true,
	writes_on: true,
	reason: null
};

export function weekOrderAnswer(
	states: WeekOrderStates,
	position: Position,
	league: WeekLeague | null,
	now: number
): WeekOrderAdvice {
	const readAt = states.read[position].projection_read_at;
	const week = readAt !== null && now >= Date.parse(readAt) ? states.read : states.unread;
	const answer = { ...week[position], ...uncountedOf(UNCOUNTED_RULES[position]) };
	if (league === null) {
		return {
			...answer,
			// A reader with no league: the board's scoring in the same sentence (week_order.go).
			read_at: null,
			moves: null,
			rows: answer.rows.map((row) => ({ ...row, roster: null, move: null }))
		};
	}
	if (!league.espn) return { ...answer, read_at: league.readAt, moves: league.moves };
	return {
		...answer,
		read_at: league.readAt,
		moves: ESPN_CLAIM,
		rows: answer.rows.map((row) => {
			const player = row.line.player;
			const hostId = player.position === 'DEF' ? espnDefenseId(player.team) : player.host_id;
			return { ...row, line: { ...row.line, player: { ...player, host_id: hostId } } };
		})
	};
}
