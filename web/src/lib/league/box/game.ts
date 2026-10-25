/** Any game of the week on the Matchup (Lane 204): each score bug opens its own game. The member's
 * bug keeps the Matchup's plain address; another team's names the roster of its first side
 * (?roster=), which the screen passes to the API's box read. The box says whose game it drew
 * (MatchupBox.viewer_side); the score and the teams of another team's game are the scoreboard's. */
import type { LeagueMatchup, MatchupSide } from '../api.ts';
import type { MatchupBox, Scoreboard } from '../inseason/api.ts';
import type { Bug } from '../home/home.ts';

/** The query field naming another team's game by its first side's roster. */
export const GAME_PARAM = 'roster';

/** Digits a roster id can be, as the API takes it (service.go maxRosterParam). */
const ROSTER = /^\d{1,9}$/;

/** The roster a bug's link names: none for the member's game, else its first side's. */
export function bugRoster(bug: Pick<Bug, 'mine' | 'sides'>): number | null {
	return bug.mine ? null : (bug.sides[0]?.rosterId ?? null);
}

/** A game's Matchup address: the plain one for the member's game, else with its roster. */
export function gameHref(matchupHref: string, roster: number | null): string {
	return roster === null
		? matchupHref
		: `${matchupHref}?${new URLSearchParams({ [GAME_PARAM]: String(roster) }).toString()}`;
}

/** The roster the page's address asks for, null with none or one no roster id can be. */
export function gameRoster(search: Pick<URLSearchParams, 'get'>): number | null {
	const asked = search.get(GAME_PARAM);
	return asked !== null && ROSTER.test(asked) ? Number(asked) : null;
}

/** The box is another team's game: an API from before Lane 204 sends no viewer_side and always
 * the member's game, so its box is drawn as theirs. */
export function isOtherGame(box: Pick<MatchupBox, 'viewer_side'> | null): boolean {
	return box?.viewer_side === 'other';
}

/** Another team's game as the Matchup draws its head and score: its sides in the box's order, each
 * with the scoreboard's points (the platform's own, as the member's sync side carries them) and the
 * box's flags; no starters of the platform's own read, as the box holds every row. Null where the
 * box is the member's game or the scoreboard has no such game. */
export function otherGame(
	box: Pick<MatchupBox, 'week' | 'sides' | 'viewer_side'> | null,
	board: Pick<Scoreboard, 'games'> | null
): LeagueMatchup | null {
	if (box === null || board === null || !isOtherGame(box)) return null;
	const first = box.sides[0];
	if (first === undefined) return null;
	const game = board.games.find((g) => g.sides.some((s) => s.roster_id === first.roster_id));
	if (game === undefined) return null;
	const sides = box.sides.map((b): MatchupSide | null => {
		const side = game.sides.find((s) => s.roster_id === b.roster_id);
		return side === undefined
			? null
			: {
					roster_id: b.roster_id,
					points: side.points,
					points_read: side.points_read,
					player_points: b.player_points,
					team_total: b.team_total,
					starters: []
				};
	});
	const [mine, opponent = null] = sides;
	return mine === null || mine === undefined ? null : { week: box.week, mine, opponent };
}
