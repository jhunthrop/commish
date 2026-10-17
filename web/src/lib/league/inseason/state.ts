/** The in-season screens' behaviour as plain functions, so it is tested apart from the components:
 * what a failed read shows, what the page shows
 * while its reads land, a narrowing that keeps only the latest answer, and a trade marked by who is
 * in it. */
import { ApiError } from '#lib/api/client.ts';
import { HTTP_STATUS, hasStatus } from '#lib/api/status.ts';
import type { PlayerLine, TradeRow, TradeTeam } from './api.ts';
import { LINES } from './words.ts';

/** What a failed read shows: the sign-in, the API's own sentence when there is no answer yet (a 409
 * out of season, a 422 with no saved scoring, a 400, a 502; a 404 for a team missing from the last
 * read, which the page offers to read again from the host), or, after an answer, a line that the
 * page shows the last read. */
export type ReadFailure =
	| { kind: 'signed-out' }
	| { kind: 'refused'; sentence: string }
	| { kind: 'no-team'; sentence: string }
	| { kind: 'stale'; sentence: string };

/** The API's code for a team missing from the league's last read (api httpx CodeTeamNotRead). */
const TEAM_NOT_READ = 'team_not_read';

export function readFailure(error: unknown, answered: boolean): ReadFailure {
	if (hasStatus(error, HTTP_STATUS.unauthorized)) return { kind: 'signed-out' };
	if (answered) return { kind: 'stale', sentence: LINES.lastRead };
	if (error instanceof ApiError && error.code === TEAM_NOT_READ) {
		return { kind: 'no-team', sentence: error.message };
	}
	return {
		kind: 'refused',
		sentence: error instanceof ApiError ? error.message : LINES.unreadable
	};
}

/** Where the page's own read of the account's leagues is. */
export type ReadState = 'pending' | 'done' | 'failed';

/** What the page shows once no read has refused it: the league not on the account, a sentence when
 * the account's leagues could not be read (tried again with the next minute's read), the screen, or
 * the rows held while the reads land. The answer carries every face and page, so no board is read. */
export type ScreenView = 'missing' | 'leagues-failed' | 'ready' | 'loading';

export function screenView(reads: {
	/** The account's leagues, read to name and place this one. */
	leagues: ReadState;
	/** This league is among them. */
	known: boolean;
	answered: boolean;
}): ScreenView {
	if (reads.leagues === 'failed') return 'leagues-failed';
	if (reads.leagues === 'done' && !reads.known) return 'missing';
	if (reads.leagues === 'done' && reads.answered) return 'ready';
	return 'loading';
}

/** The trade screen's decision when none is marked: the best trade for you among those the other
 * team gains from, a close call for them only when no other trade is found. */
export function bestTrade(teams: readonly TradeTeam[]): { row: TradeRow; team: TradeTeam } | null {
	const all = teams.flatMap((team) => team.trades.map((row) => ({ row, team })));
	const best = (rows: typeof all): (typeof all)[number] | null =>
		rows.reduce<(typeof all)[number] | null>(
			(top, t) => (top === null || t.row.my_gain > top.row.my_gain ? t : top),
			null
		);
	return best(all.filter((t) => !t.row.close_for_them)) ?? best(all);
}

/** A picker player's key: his board id, which the trades narrow by, or his host id for a player our
 * board does not place (no trade can hold him). */
export function pickKey(line: PlayerLine): string {
	return line.player.board_id ?? `host:${line.player.host_id}`;
}

/** The trade picker's players: every one on your roster as the API lists it, a trade found or not,
 * and theirs from the trades found, each once. */
export function pickerPlayers(
	roster: readonly PlayerLine[],
	teams: readonly TradeTeam[]
): { yours: readonly PlayerLine[]; theirs: readonly PlayerLine[] } {
	const theirs = new Map<string, PlayerLine>();
	for (const line of teams.flatMap((t) => t.trades.flatMap((r) => r.get))) {
		if (line.player.board_id !== null && !theirs.has(line.player.board_id)) {
			theirs.set(line.player.board_id, line);
		}
	}
	return { yours: roster, theirs: [...theirs.values()] };
}

/** Whether a trade found holds the picked player (true with none picked). */
export function tradeHolding(teams: readonly TradeTeam[], key: string | null): boolean {
	if (key === null) return true;
	return teams.some((t) =>
		t.trades.some((r) => [...r.give, ...r.get].some((l) => l.player.board_id === key))
	);
}

/** A narrowing's outcome: every row again, the narrowed answer, a sentence when it could not be
 * read, or nothing when another choice was made before it landed. */
export type Narrowed<T> =
	| { kind: 'all' }
	| { kind: 'answer'; answer: T }
	| { kind: 'failed'; sentence: string }
	| { kind: 'overtaken' };

/** Reads a narrowing (a position, a player) and keeps only the latest choice's answer. */
export class Narrowing<K, T> {
	#latest = 0;
	readonly #read: (key: K) => Promise<T>;

	constructor(read: (key: K) => Promise<T>) {
		this.#read = read;
	}

	async choose(key: K | null): Promise<Narrowed<T>> {
		const mine = (this.#latest += 1);
		if (key === null) return { kind: 'all' };
		try {
			const answer = await this.#read(key);
			return mine === this.#latest ? { kind: 'answer', answer } : { kind: 'overtaken' };
		} catch (error) {
			if (mine !== this.#latest) return { kind: 'overtaken' };
			const sentence = error instanceof ApiError ? error.message : LINES.narrowingUnread;
			return { kind: 'failed', sentence };
		}
	}
}

/** A trade by who is in it: the team and both sides' players, each side in a fixed order, so a
 * re-read that reorders a team's trades keeps the same trade marked. */
export function tradeKey(team: number, row: TradeRow): string {
	const ids = (side: TradeRow['give']): string =>
		side
			.map((line) => line.player.host_id)
			.sort()
			.join('+');
	return `${String(team)}:${ids(row.give)}>${ids(row.get)}`;
}

/** The marked trade in an answer, null when it is no longer there. */
export function markedTrade(
	teams: readonly TradeTeam[],
	key: string | null
): { row: TradeRow; team: TradeTeam } | null {
	if (key === null) return null;
	for (const team of teams) {
		const row = team.trades.find((r) => tradeKey(team.roster_id, r) === key);
		if (row) return { row, team };
	}
	return null;
}
