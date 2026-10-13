/** The report's one big number and the sentences beside it, true at every rank: a team that leads
 * is read against the next team, any other against the team just ahead and the leader. */
import { ordinal } from '#lib/format/number.ts';
import type { MockReport } from '../api.ts';

type Team = MockReport['standings'][number];

export interface Headline {
	/** Projected points from the seat's starters. */
	points: number;
	rank: number;
	/** "5th of 12. 4th is at 1,527, the leader at 1,593". */
	standing: string;
	/** The basis sentence after "Points are our projections, the same numbers the board ranks by". */
	read: string;
}

export function points(x: number): string {
	return Math.round(x).toLocaleString('en-US');
}

function at(team: Team | undefined): string {
	return team === undefined ? '' : points(team.points);
}

/** The seat's headline, or null when the standings do not hold the seat. */
export function headline(standings: readonly Team[], seat: number, teams: number): Headline | null {
	const mine = standings.find((t) => t.seat === seat);
	if (!mine) return null;
	const byRank = [...standings].sort((a, b) => a.rank - b.rank);
	const leader = byRank[0];
	const ahead = byRank.find((t) => t.rank === mine.rank - 1);
	const of = `${ordinal(mine.rank)} of ${teams}`;
	if (mine.rank === 1 || leader === undefined) {
		const next = byRank.find((t) => t.seat !== seat);
		return {
			points: mine.points,
			rank: mine.rank,
			standing: next ? `${of}, the next team at ${at(next)}` : of,
			read: 'so a team drafted off the board should lead this table, as this one does. The useful read is how far ahead, and where it came from.'
		};
	}
	const behind = points(leader.points - mine.points);
	const standing =
		mine.rank === 2 || ahead === undefined || ahead.seat === leader.seat
			? `${of}, the leader at ${at(leader)}`
			: `${of}. ${ordinal(ahead.rank)} is at ${at(ahead)}, the leader at ${at(leader)}`;
	return {
		points: mine.points,
		rank: mine.rank,
		standing,
		read: `so a team drafted off the board should lead this table. This one finished ${behind} behind the leader, so it took less of what the board likes than the teams ahead of it. Pick by pick shows where.`
	};
}
