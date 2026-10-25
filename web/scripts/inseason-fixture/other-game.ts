// Any game of the recorded week as the API's box draws it with ?roster= (Lane 204, inseason
// matchup.go Matchup(roster)): the roster's side first, its opponent's second when the week pairs
// them, each side's starters in the league's slots from the recorded Sleeper matchups and the rest
// of its roster on the bench, every player with the line the other answers hold for him (a player
// no answer lists is left out, as scoreboard-at.ts counts him). The box is another team's game: it
// says so (viewer_side) and carries no standing, whose words are the member's. serve.ts restates it
// at its moment as it does the member's box.
import type { MatchupBox, PlayerLine } from '../../src/lib/league/inseason/api.ts';
import type { Recorded, SleeperMatchup } from './scoreboard-at.ts';

type BoxSide = MatchupBox['sides'][number];
type Slot = BoxSide['starters'][number]['slot'];

/** The query field the Matchup's box takes another roster by (service.go fieldRoster). */
export const ROSTER_PARAM = 'roster';
/** The API's words for a roster it refuses (service.go gameRosterWords). */
export const ROSTER_WORDS = "That team is not in this league's last read";
/** Digits a roster id can be (service.go maxRosterParam). */
const ROSTER = /^\d{1,9}$/;
/** A starter spot the platform left empty. */
const EMPTY = '0';

/** The asked roster: absent, a whole number, or refused (the API's 400). */
export function askedRoster(search: URLSearchParams): number | null | 'invalid' {
	const asked = search.get(ROSTER_PARAM);
	if (asked === null) return null;
	return ROSTER.test(asked) ? Number(asked) : 'invalid';
}

/** One recorded side as the box draws it: its starters in the member's box's slot order (the
 * league's), each slot by its index among the recorded starters, and the rest of its roster. */
function sideOf(
	m: SleeperMatchup,
	slots: readonly Slot[],
	lines: ReadonlyMap<string, PlayerLine>,
	flags: Pick<BoxSide, 'player_points' | 'team_total'>
): BoxSide {
	const starters = m.starters.flatMap((id, i) => {
		const line = id === EMPTY ? undefined : lines.get(id);
		const slot = slots[i] ?? (line?.player.position as Slot | undefined);
		return line === undefined || slot === undefined ? [] : [{ slot, line }];
	});
	const starting = new Set(m.starters);
	const bench = m.players
		.filter((id) => !starting.has(id))
		.flatMap((id) => {
			const line = lines.get(id);
			return line === undefined ? [] : [line];
		});
	return { roster_id: m.roster_id, ...flags, starters, bench };
}

/** The roster's game as the API's box draws it before any moment restates it, null for a roster the
 * recorded week does not list (the API's 404). */
export function otherGameBox(
	roster: number,
	week: Pick<Recorded, 'me' | 'matchups' | 'lines'>,
	box: MatchupBox
): MatchupBox | null {
	const own = week.matchups.find((m) => m.roster_id === roster);
	const me = week.matchups.find((m) => m.roster_id === week.me);
	const mine = box.sides.find((s) => s.roster_id === week.me);
	if (own === undefined || me === undefined || mine === undefined) return null;
	// The league's slots by the member's recorded starters' order: the box keeps the same order.
	const slots = mine.starters.map((s) => s.slot);
	const flags = { player_points: mine.player_points, team_total: mine.team_total };
	const opponent =
		own.matchup_id === null
			? undefined
			: week.matchups.find((m) => m.matchup_id === own.matchup_id && m.roster_id !== roster);
	const sides = [own, ...(opponent === undefined ? [] : [opponent])].map((m) =>
		sideOf(m, slots, week.lines, flags)
	);
	return { ...box, viewer_side: 'other', standing: null, decided: null, sides };
}
