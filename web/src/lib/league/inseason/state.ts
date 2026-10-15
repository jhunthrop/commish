/** The in-season screens' behaviour as plain functions, so it is tested apart from the components:
 * what a failed read shows, what the page shows
 * while its reads land, a narrowing that keeps only the latest answer, and a trade marked by who is
 * in it. */
import { ApiError } from '#lib/api/client.ts';
import { HTTP_STATUS, hasStatus } from '#lib/api/status.ts';
import type { TradeRow, TradeTeam } from './api.ts';
import { LINES } from './words.ts';

/** What a failed read shows: the sign-in, the API's own sentence when there is no answer yet (a 404
 * for a team missing from the last read, a 409 out of season, a 422 with no saved scoring, a 400, a
 * 502), or, after an answer, a line that the page shows the last read. */
export type ReadFailure =
	| { kind: 'signed-out' }
	| { kind: 'refused'; sentence: string }
	| { kind: 'stale'; sentence: string };

export function readFailure(error: unknown, answered: boolean): ReadFailure {
	if (hasStatus(error, HTTP_STATUS.unauthorized)) return { kind: 'signed-out' };
	if (answered) return { kind: 'stale', sentence: LINES.lastRead };
	return {
		kind: 'refused',
		sentence: error instanceof ApiError ? error.message : LINES.unreadable
	};
}

/** Where one of the page's own reads is: the account's leagues, or the run's board. */
export type ReadState = 'pending' | 'done' | 'failed';

/** What the page shows once no read has refused it: the league not on the account, a sentence for
 * a read that failed (each tried again with the next minute's read), the screen, or the rows held
 * while the reads land. */
export type ScreenView = 'missing' | 'leagues-failed' | 'board-failed' | 'ready' | 'loading';

export function screenView(reads: {
	/** The account's leagues, read to name and place this one. */
	leagues: ReadState;
	/** This league is among them. */
	known: boolean;
	board: ReadState;
	answered: boolean;
}): ScreenView {
	if (reads.leagues === 'failed') return 'leagues-failed';
	if (reads.leagues === 'done' && !reads.known) return 'missing';
	if (reads.board === 'failed') return 'board-failed';
	if (reads.leagues === 'done' && reads.board === 'done' && reads.answered) return 'ready';
	return 'loading';
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
