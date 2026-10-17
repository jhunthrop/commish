// The player card's reads (Lane 66h) answered from the fixture: his line wherever the recorded
// screens carry it (the Lineup, the Matchup, the waiver adds, the trades), else a line built from the
// recorded week's game for his club; and, read in the league, the verb its screens give him, by the
// same rules as the API (api/internal/inseason/player.go): start where our lineup starts him and the
// platform's does not, the lineup for the rest of the member's own, a trade where another roster holds
// him, the platform's waiver page where none does.
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	TradeAdvice,
	WaiverAdvice,
	WeekFacts
} from '../../src/lib/league/inseason/api.ts';
import type { components } from '../../src/lib/api/types.ts';
import type { GameWeek } from '../../src/lib/format/game-facts.ts';

type PlayerWeek = components['schemas']['PlayerWeek'];
type PlayerVerb = components['schemas']['PlayerVerb'];

/** A recorded week sheet's figures (data/week-sheets.json, Lane 72's three). */
export interface Sheet {
	name: string;
	week_projection: number | null;
	opp_rank: number | null;
	opp_of: number | null;
	points_a_game_allowed: number | null;
	season_avg: number | null;
	last_games: { week: number; points: number }[];
}

export interface Recorded {
	sync: LeagueSync;
	lineup: LineupAdvice;
	waivers: WaiverAdvice;
	trades: TradeAdvice;
	matchup: MatchupBox;
	games: GameWeek;
	sheets: Readonly<Record<string, Sheet>>;
}

/** Every line the recorded screens carry. */
function linesOf(r: Recorded): PlayerLine[] {
	return [
		...r.lineup.slots.flatMap((slot) => [slot.ours, ...(slot.host ? [slot.host] : [])]),
		...r.lineup.bench,
		...r.lineup.reserve,
		...r.waivers.rows.map((row) => row.add),
		...r.trades.roster,
		...r.trades.teams.flatMap((team) => team.roster),
		...r.matchup.sides.flatMap((side) => [...side.starters.map((s) => s.line), ...side.bench])
	];
}

/** His club's recorded game as the week's facts, with nothing of his own. */
function factsFor(r: Recorded, team: string): WeekFacts {
	const game = r.games.games.find((g) => g.team === team);
	return {
		week: r.games.week,
		opponent: game?.opponent ?? null,
		home: game?.home ?? null,
		kickoff: game?.kickoff ?? null,
		bye: game === undefined,
		designation: null,
		played: game?.played ?? false,
		points_this_week: null,
		last_games: [],
		allowed_to_position: null,
		game_total: game?.game_total ?? null,
		spread: game?.spread ?? null,
		roof: game?.roof ?? null,
		weather: game?.weather ?? null
	};
}

/** A line for a player no recorded screen carries: his club's recorded game, and his recorded week
 * sheet's figures where Lane 72 recorded one. */
function built(r: Recorded, id: string, team: string, position: string): PlayerLine {
	const sheet = r.sheets[id];
	const facts = factsFor(r, team);
	const allowed =
		sheet?.opp_rank == null || sheet.points_a_game_allowed === null
			? null
			: {
					points_a_game: sheet.points_a_game_allowed,
					rank: sheet.opp_rank,
					of: sheet.opp_of ?? 32,
					position
				};
	return {
		player: {
			host_id: '',
			board_id: id,
			name: sheet?.name ?? '',
			position,
			team,
			injured_reserve: false
		},
		headshot: null,
		slug: null,
		position_rank: null,
		points_over_replacement: null,
		rest_of_season_per_game: null,
		week_projection: sheet?.week_projection ?? null,
		projection_delta: null,
		opp_rank: sheet?.opp_rank ?? null,
		season_avg: sheet?.season_avg ?? null,
		last_points: sheet?.last_games[0]?.points ?? null,
		held: false,
		facts: { ...facts, last_games: sheet?.last_games ?? [], allowed_to_position: allowed }
	};
}

function verbFor(r: Recorded, id: string, claims: boolean): PlayerVerb {
	const none = { holder: null, host_url: null, note: null };
	const advised = r.lineup.slots.find((slot) => slot.ours.player.board_id === id);
	if (advised) return { ...none, kind: advised.changed ? 'start' : 'lineup' };
	if ([...r.lineup.bench, ...r.lineup.reserve].some((l) => l.player.board_id === id))
		return { ...none, kind: 'lineup' };
	const holder = r.sync.held_by[id];
	if (holder !== undefined && holder !== r.sync.me) {
		const team = r.sync.teams.find((t) => t.roster_id === holder);
		return { ...none, kind: 'trade', holder: team?.name ?? null };
	}
	if (holder === r.sync.me) return { ...none, kind: 'lineup' };
	// Where the claim is made from here (the ESPN stand-ins), the verb is the claim.
	if (claims) return { ...none, kind: 'claim' };
	return { ...none, kind: 'waivers', host_url: r.waivers.host_waivers_url };
}

/** His week, read with no league (verb null) or in the fixture's league. */
export function playerWeek(
	r: Recorded,
	id: string,
	at: { team: string; position: string } | null,
	inLeague: boolean,
	claims = false
): PlayerWeek | null {
	const line = linesOf(r).find((l) => l.player.board_id === id);
	const team = line?.player.team ?? at?.team;
	if (team === undefined) return null;
	return {
		week: r.lineup.week,
		line: line ?? built(r, id, team, at?.position ?? ''),
		projection_scoring: r.lineup.projection_scoring,
		projection_read_at: r.lineup.projection_read_at,
		projection_previous_read_at: r.lineup.projection_previous_read_at,
		verb: inLeague ? verbFor(r, id, claims) : null
	};
}
