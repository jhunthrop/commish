/** What the league page reads off a sync: the host's name as a mechanism, the read's age, a team's
 * record, a move in words, and the drafter's roster and the pool as board players. Pure functions
 * over the API's answer. */
import { plural } from '#lib/format/number.ts';
import type { Board, RoomPlayer } from '#lib/room/model.ts';
import type { LeagueHost, LeagueMove, LeaguePlayer, LeagueSync, LeagueTeam } from './api.ts';

/** How often an open league page reads the league again. The API reads the host at most once a
 * minute whatever the number of viewers, so a faster page would only see the same read. */
export const POLL_MS = 60_000;

const HOST_WORDS: Readonly<Record<LeagueHost, string>> = {
	sleeper: 'Sleeper',
	mfl: 'MyFantasyLeague'
};

/** The host as a sentence names it. */
export function hostWords(host: LeagueHost): string {
	return HOST_WORDS[host];
}

/** Hosts a link may come from today, as the attach page says it. */
export const HOSTS_LINE = 'Works with Sleeper leagues and public MyFantasyLeague leagues.';

const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;

/** How long ago a read was: "just now", "4 minutes ago", "2 hours ago". */
export function agoWords(seconds: number): string {
	if (seconds < MINUTE * SECOND) return 'just now';
	if (seconds < HOUR) return `${plural(Math.floor(seconds / MINUTE), 'minute')} ago`;
	return `${plural(Math.floor(seconds / HOUR), 'hour')} ago`;
}

/** The read's line: when the host was last read, and, when it has failed since, that this is the
 * last read we have. */
export function readLine(sync: LeagueSync, now: Date): string {
	const age = Math.max(0, (now.getTime() - Date.parse(sync.read_at)) / 1000);
	const host = hostWords(sync.host);
	if (sync.host_stale_seconds > 0) {
		return `${host} is not answering. This is our last read, ${agoWords(age)}.`;
	}
	return `Read from ${host} ${agoWords(age)}.`;
}

/** "5-1", or "5-1-1" with ties. */
export function recordWords(team: LeagueTeam): string {
	const base = `${String(team.wins)}-${String(team.losses)}`;
	return team.ties > 0 ? `${base}-${String(team.ties)}` : base;
}

/** A team's name for a sentence, by roster id. */
export function teamName(sync: LeagueSync, rosterId: number): string {
	const name = sync.teams.find((t) => t.roster_id === rosterId)?.name ?? '';
	return name !== '' ? name : `Team ${String(rosterId)}`;
}

/** A move as a line: who did it, and who came and went, with no closing period. */
export function moveLine(sync: LeagueSync, move: LeagueMove): { lead: string; text: string } {
	const names = (list: LeagueMove['adds']): string => list.map((m) => m.player.name).join(', ');
	if (move.kind === 'trade') {
		const [a = 0, b = 0] = move.roster_ids;
		const toA = move.adds.filter((m) => m.roster_id === a);
		const toB = move.adds.filter((m) => m.roster_id === b);
		return {
			lead: `${teamName(sync, a)} and ${teamName(sync, b)}`,
			text: `traded. ${teamName(sync, a)} got ${names(toA) || 'nobody'}, ${teamName(sync, b)} got ${names(toB) || 'nobody'}`
		};
	}
	const who = teamName(sync, move.roster_ids[0] ?? 0);
	const how = move.kind === 'waiver' ? 'claimed' : 'picked up';
	const added = move.adds.length > 0 ? `${how} ${names(move.adds)}` : '';
	const dropped = move.drops.length > 0 ? `dropped ${names(move.drops)}` : '';
	return { lead: who, text: [added, dropped].filter((s) => s !== '').join(' and ') };
}

/** A league player as a board row: the board's numbers when we placed him, the host's own name,
 * position and team when we did not. */
export function rowOf(board: Board, player: LeaguePlayer): RoomPlayer | null {
	if (player.board_id !== null) {
		const placed = board.byId.get(player.board_id);
		if (placed) return placed;
	}
	return null;
}

/** The pool as board rows, in board order. */
export function poolRows(board: Board, sync: LeagueSync): readonly RoomPlayer[] {
	const free = new Set(sync.pool);
	return board.players.filter((p) => free.has(p.id));
}

/** The drafter's team. */
export function myTeam(sync: LeagueSync): LeagueTeam | undefined {
	return sync.teams.find((t) => t.roster_id === sync.me);
}

/** The drafter's place in the standings, 1-based. */
export function myPlace(sync: LeagueSync): number {
	return sync.teams.findIndex((t) => t.roster_id === sync.me) + 1;
}
