// The API's platform games (inseason facts.go gamesOf, Lane 111, B23), mirrored for the stand-in: a
// rostered player's final the platform scored and our stats have not landed counts on the platform's
// points in his Avg, Last and GP, as a game whose source is the platform. The platform scores a player
// who sat as 0, so 0 is no game. Only a platform that sends each player's points does this (leaguesync
// playerPointsHosts): Sleeper, MyFantasyLeague and ESPN. From FIXTURE_STATS_CLOCK our stats hold the
// week: the stand-in counts the same points as ours then, so no row is the platform's.
import type { LeagueHost } from '../../src/lib/league/api.ts';
import type {
	GamePoints,
	LineupAdvice,
	MatchupBox,
	PlayerLine
} from '../../src/lib/league/inseason/api.ts';
import { FIXTURE_STATS_CLOCK } from './clock.ts';
import { roundTenth } from './tenths.ts';

const PLAYER_POINTS_HOSTS: ReadonlySet<LeagueHost> = new Set(['sleeper', 'mfl', 'espn']);

/** A platform's points for one player's final, his week. */
interface PlatformGame {
	week: number;
	points: number;
	source: NonNullable<GamePoints['source']>;
}

/** Each rostered player's final the week's lines carry the platform's points for, by host id: his
 * game played and his points nonzero. */
export function platformGames(
	host: LeagueHost,
	week: { lineup: LineupAdvice; matchup: MatchupBox },
	now: number
): ReadonlyMap<string, PlatformGame> {
	const out = new Map<string, PlatformGame>();
	if (!PLAYER_POINTS_HOSTS.has(host)) return out;
	const source = now >= Date.parse(FIXTURE_STATS_CLOCK) ? 'stats' : 'platform';
	const lines = [
		...week.lineup.slots.flatMap((s) => (s.host === null ? [s.ours] : [s.ours, s.host])),
		...week.lineup.bench,
		...week.matchup.sides.flatMap((s) => [...s.starters.map((st) => st.line), ...s.bench])
	];
	for (const { player, facts } of lines) {
		const points = facts.points_this_week;
		if (facts.played && points !== null && points !== 0)
			out.set(player.host_id, { week: facts.week, points, source });
	}
	return out;
}

/** His line with the platform's game counted where our stats hold no game of that week: newest
 * first, Avg over the games with it, Last its points, GP one more. */
export function withPlatformGame(line: PlayerLine, game: PlatformGame): PlayerLine {
	const held = line.facts.last_games;
	if (held.some((g) => g.week === game.week)) return line;
	const games = line.games_played ?? held.length;
	const total = (line.season_avg ?? 0) * games + game.points;
	const counted: GamePoints = { week: game.week, points: game.points, source: game.source };
	return {
		...line,
		season_avg: roundTenth(total / (games + 1)),
		last_points: game.points,
		games_played: games + 1,
		facts: { ...line.facts, last_games: [counted, ...held] }
	};
}

function isLine(value: Record<string, unknown>): value is Record<string, unknown> & PlayerLine {
	return 'player' in value && 'facts' in value && 'season_avg' in value;
}

/** The answer with every rostered player's platform game counted: a new value, the stored one left
 * as it was. */
export function platformed<T>(body: T, games: ReadonlyMap<string, PlatformGame>): T {
	if (games.size === 0) return body;
	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk);
		if (value === null || typeof value !== 'object') return value;
		const out = Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)])
		);
		if (!isLine(out)) return out;
		const game = games.get(out.player.host_id);
		return game === undefined ? out : withPlatformGame(out, game);
	};
	return walk(body) as T;
}
