// Builds the kickers' and defenses' week fixture (Lane 66w), GET /order/week's and GET
// /leagues/attached/{id}/order/week's answers for week 6, in two states: the week read (Saturday,
// FIXTURE_WEEK_CLOCK) and the week before its projection is in (Tuesday, FIXTURE_UNREAD_CLOCK). The
// rows follow the API's rules (api/internal/inseason/week_order.go): one a club, a club's kicker the
// one the projection names with the higher Proj; the games still to play by Proj, ties by Avg, then
// the games kicked off by kickoff, then the clubs on bye; an add on the first five free rows still to
// play.
//   - REAL: each club's game (opponent, home, kickoff, expected points, roof, weather) from
//     data/games.json, GET /games/week's recorded week 6; the kickers' and defenses' names, clubs and
//     headshots from dev's directory (data/kdef-directory.json, read only); the member's own defenses
//     from the recorded league's roster (sync.json); the projection's read time is the fixture's
//     (lineup.json).
//   - STAND-INS, named in the shots' caption: every Proj is the fixture's one projection snapshot, the
//     dev store's week 1 figure (projection.json); Opp rank, Avg and Last are made up from each club's
//     code (dev holds no kicking source yet); the other teams' kickers and defenses are dealt to the
//     recorded league's team names by club.
//
//   node scripts/inseason-fixture/week-order.ts
import { readFile, writeFile } from 'node:fs/promises';
import { format as prettierFormat, resolveConfig } from 'prettier';
import type { components } from '../../src/lib/api/types.ts';
import { FIXTURE_UNREAD_CLOCK, FIXTURE_WEEK_CLOCK } from './clock.ts';
import { roundTenth } from './tenths.ts';

type WeekOrderAdvice = components['schemas']['WeekOrderAdvice'];
type WeekOrderRow = components['schemas']['WeekOrderRow'];
type PlayerLine = components['schemas']['PlayerLine'];
type ClubGame = components['schemas']['ClubGame'];
type LeagueSync = components['schemas']['LeagueSync'];
type LineupAdvice = components['schemas']['LineupAdvice'];
type Position = WeekOrderAdvice['position'];

interface DirectoryRow {
	id: string;
	name: string;
	position: 'K' | 'DEF';
	team: string;
	headshot: string;
}

interface Projection {
	players: Record<string, { position: string; team: string; ppr: number }>;
	defenses: Record<string, number>;
}

const DATA = new URL('./data/', import.meta.url);
const read = async <T>(name: string): Promise<T> =>
	JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T;

const [directory, projection, games, sync, lineup] = await Promise.all([
	read<DirectoryRow[]>('kdef-directory'),
	read<Projection>('projection'),
	read<components['schemas']['GameWeek']>('games'),
	read<LeagueSync>('sync'),
	read<LineupAdvice>('lineup')
]);
const WEEK = games.week;
const CLUBS = 32;
/** The first five free rows still to play carry the add (week_order.go addsShown). */
const ADDS_SHOWN = 5;
/** Every third club's kicker or defense sits on another team in the stand-in rosters. */
const HELD_EVERY = 3;
const gameOf = new Map(games.games.map((g) => [g.team, g] as const));
const clubs = [...new Set(directory.map((row) => row.team))].sort();

/** A club's stand-in figure, steady from its code: a whole number in [0, span). */
function seeded(club: string, salt: number, span: number): number {
	let h = salt;
	for (const ch of club) h = (h * 31 + ch.charCodeAt(0)) % 9973;
	return h % span;
}

/** The stand-in rank of each club's points allowed to a position, 1st the fewest. */
function allowedRanks(salt: number): Map<string, number> {
	const order = [...clubs].sort((a, b) => seeded(a, salt, 997) - seeded(b, salt, 997));
	return new Map(order.map((club, i) => [club, i + 1] as const));
}

const RANKS: Readonly<Record<Position, Map<string, number>>> = {
	K: allowedRanks(7),
	DEF: allowedRanks(11)
};

/** The projection's points, a tenth, for a kicker by his id and a defense by its club. */
function projected(row: DirectoryRow): number | null {
	const points =
		row.position === 'DEF' ? projection.defenses[row.team] : projection.players[row.id]?.ppr;
	return points === undefined ? null : roundTenth(points);
}

/** The member's own and the other teams' holdings, by club (stand-ins but the member's defenses). */
function rosterOf(row: DirectoryRow): NonNullable<WeekOrderRow['roster']> {
	const mine = sync.roster.some(
		(r) => r.player.position === row.position && r.player.team === row.team
	);
	if (mine) return { kind: 'yours', team: null };
	const at = clubs.indexOf(row.team);
	if (at % HELD_EVERY !== 0) return { kind: 'free', team: null };
	const others = sync.teams.filter((t) => t.roster_id !== sync.me);
	return { kind: 'team', team: others[(at / HELD_EVERY) % others.length]?.name ?? null };
}

/** His week's facts at the clock: the game played once kicked off, its figures only once read. */
function factsOf(row: DirectoryRow, at: number, avg: number, last: number): PlayerLine['facts'] {
	const game: ClubGame | undefined = gameOf.get(row.team);
	const opp = game === undefined ? undefined : RANKS[row.position].get(game.opponent);
	const kicked = game !== undefined && Date.parse(game.kickoff) <= at;
	const readOf = (stamp: string | undefined): boolean =>
		stamp !== undefined && Date.parse(stamp) <= at;
	return {
		week: WEEK,
		opponent: game?.opponent ?? null,
		home: game?.home ?? null,
		kickoff: game?.kickoff ?? null,
		bye: game === undefined,
		designation: null,
		played: kicked,
		points_this_week: null,
		last_games: [{ week: WEEK - 1, points: last }],
		allowed_to_position:
			opp === undefined
				? null
				: { points_a_game: roundTenth(avg * 0.9), rank: opp, of: CLUBS, position: row.position },
		game_total: game !== undefined && readOf(game.game_total?.read_at) ? game.game_total : null,
		spread: game !== undefined && readOf(game.spread?.read_at) ? game.spread : null,
		roof: game?.roof ?? null,
		weather: game !== undefined && readOf(game.weather?.read_at) ? game.weather : null
	};
}

function lineOf(row: DirectoryRow, proj: number | null, at: number): PlayerLine {
	const avg = roundTenth(
		(row.position === 'K' ? 4 : 3) + seeded(row.team, row.position === 'K' ? 3 : 5, 70) / 10
	);
	const last = seeded(row.team, row.position === 'K' ? 13 : 17, 16);
	const facts = factsOf(row, at, avg, last);
	return {
		player: {
			host_id: row.id,
			board_id: row.id,
			name: row.name,
			position: row.position,
			team: row.team,
			injured_reserve: false
		},
		headshot: row.headshot === '' ? null : row.headshot,
		slug: null,
		position_rank: null,
		points_over_replacement: null,
		rest_of_season_per_game: null,
		week_projection: facts.bye ? null : proj,
		projection_delta: null,
		opp_rank: facts.allowed_to_position?.rank ?? null,
		season_avg: avg,
		last_points: last,
		held: false,
		facts
	};
}

const SECTION_PLACE: Readonly<Record<WeekOrderRow['section'], number>> = {
	to_play: 0,
	kicked_off: 1,
	bye: 2
};

/** Higher first, a held figure before none. */
const higher = (a: number | null, b: number | null): number =>
	a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;

function ordered(a: WeekOrderRow, b: WeekOrderRow): number {
	if (a.section !== b.section) return SECTION_PLACE[a.section] - SECTION_PLACE[b.section];
	const la = a.line;
	const lb = b.line;
	if (a.section === 'kicked_off' && la.facts.kickoff !== lb.facts.kickoff)
		return Date.parse(la.facts.kickoff ?? '') - Date.parse(lb.facts.kickoff ?? '');
	return (
		higher(la.week_projection, lb.week_projection) ||
		higher(la.season_avg, lb.season_avg) ||
		la.player.name.localeCompare(lb.player.name)
	);
}

/** One row a club: a club's kicker the projected one with the higher Proj (week_order.go clubPick). */
function clubRows(position: Position): DirectoryRow[] {
	const out = new Map<string, DirectoryRow>();
	for (const row of directory.filter((r) => r.position === position)) {
		const held = out.get(row.team);
		if (held === undefined || (projected(row) ?? -1) > (projected(held) ?? -1))
			out.set(row.team, row);
	}
	return [...out.values()];
}

function advice(position: Position, at: number, landed: boolean): WeekOrderAdvice {
	let adds = 0;
	const rows = clubRows(position)
		.map((row): WeekOrderRow => {
			const line = lineOf(row, landed ? projected(row) : null, at);
			const section = line.facts.bye ? 'bye' : line.facts.played ? 'kicked_off' : 'to_play';
			return { line, section, roster: rosterOf(row), move: null };
		})
		.sort(ordered)
		.map((row) => {
			if (row.roster?.kind !== 'free' || row.section !== 'to_play' || adds >= ADDS_SHOWN)
				return row;
			adds += 1;
			return { ...row, move: 'add' as const };
		});
	return {
		week: WEEK,
		position,
		basis_note: '',
		read_at: lineup.read_at,
		projection_read_at: landed ? lineup.projection_read_at : null,
		projection_scoring: lineup.projection_scoring,
		moves: null,
		rows
	};
}

const states = (at: string, landed: boolean): Record<Position, WeekOrderAdvice> => ({
	K: advice('K', Date.parse(at), landed),
	DEF: advice('DEF', Date.parse(at), landed)
});
const out = {
	read: states(FIXTURE_WEEK_CLOCK, true),
	unread: states(FIXTURE_UNREAD_CLOCK, false)
};
const file = new URL('week-order.json', DATA);
const text = await prettierFormat(JSON.stringify(out), {
	...(await resolveConfig(file.pathname)),
	parser: 'json'
});
await writeFile(file, text);
process.stdout.write(
	`week-order.json: ${String(out.read.K.rows.length)} kickers, ${String(out.read.DEF.rows.length)} defenses\n`
);
