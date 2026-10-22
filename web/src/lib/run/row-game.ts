/**
 * THE GAME A LOG ROW IS (Lane 136). A week's row is his page club's game, or, for a player who moved,
 * the game of the club his line that week was for: a mover's special-teams snaps in a game not yet in
 * the records make that week still to play under that club's opponent, which may be his page club's bye
 * (the contract test's case). The row names its opponent and home, and in one week those pin one game
 * on one club's slate, so the game is found there. A row naming an opponent no club plays that week is
 * no game at all, even when his page club plays (a false row, Lane 138): the writer names every opponent
 * from a slate game, so only a wrong row reads so, and the reader refuses its page. The reader's kickoff
 * rule (season-checks.ts) and the page's days still to play (server/pages/player-season.ts) read it, so
 * the two never disagree.
 */
import type { GameLogRow } from './season.ts';
import type { Game, Slate } from './schema.ts';

type Row = Pick<GameLogRow, 'week' | 'opponent' | 'home'>;

/** The row's game: his club's game that week when it is the row's (or the row names none), else the
 * game on the slate whose week, opponent and home are the row's; null when no club has it. */
export function rowGame(slates: ReadonlyMap<string, Slate>, team: string, row: Row): Game | null {
	const own = slates.get(team)?.games.find((game) => game.week === row.week) ?? null;
	const named = row.opponent;
	if (named === null || (own !== null && own.opponent === named && own.home === row.home))
		return own;
	for (const slate of slates.values()) {
		const found = slate.games.find(
			(game) => game.week === row.week && game.opponent === named && game.home === row.home
		);
		if (found) return found;
	}
	return null;
}
