/** What the league page reads off a sync: the host's name as a mechanism, the read's age, a team's
 * record, a move in words, and the drafter's roster and the pool as board players. Pure functions
 * over the API's answer. */
import { fixed, plural, signed } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { IndexSeason } from '#lib/run/schema.ts';
import type { LeagueBoard, LeagueBoardPlayer } from './board.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import type { FaceStatus } from '#lib/ui/face-status.ts';
import type {
	LeagueHost,
	LeagueMove,
	LeaguePlayer,
	LeagueSync,
	LeagueTeam,
	RosterSpot
} from './api.ts';
import type { components } from '#lib/api/types.ts';

type BoardFormat = components['schemas']['BoardFormat'];
type ScoringPreset = components['schemas']['ScoringPreset'];

/** How often an open league page reads the league again. The API reads the host at most once a
 * minute whatever the number of viewers, so a faster page would only see the same read. */
export const POLL_MS = 60_000;

const HOST_WORDS: Readonly<Record<LeagueHost, string>> = {
	sleeper: 'Sleeper',
	mfl: 'MyFantasyLeague',
	ffpc: 'FFPC'
};

/** The host as a sentence names it. */
export function hostWords(host: LeagueHost): string {
	return HOST_WORDS[host];
}

/** The hosts a league may come from here, as the attach page says it: FFPC only where it is open
 * (HOST_FFPC_ENABLED). */
export function hostsLine(ffpcOn: boolean): string {
	return ffpcOn
		? 'Works with Sleeper leagues, public MyFantasyLeague leagues and FFPC leagues.'
		: 'Works with Sleeper leagues and public MyFantasyLeague leagues.';
}

const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;

/** How long ago a read was: "just now", "4 minutes ago", "2 hours ago". */
export function agoWords(seconds: number): string {
	if (seconds < MINUTE * SECOND) return 'just now';
	if (seconds < HOUR) return `${plural(Math.floor(seconds / MINUTE), 'minute')} ago`;
	return `${plural(Math.floor(seconds / HOUR), 'hour')} ago`;
}

/** The read's line: when the host was last read, and, when the last read failed, why, and that this
 * is the last read we have. A kept read waiting on the next one names no failure. */
export function readLine(sync: LeagueSync, now: Date): string {
	const age = Math.max(0, (now.getTime() - Date.parse(sync.read_at)) / 1000);
	const host = hostWords(sync.host);
	const read = `Read from ${host} ${agoWords(age)}.`;
	const last = `This is our last read, ${agoWords(age)}.`;
	if (sync.host_signed_out) return `No one in this league is signed in to ${host}. ${last}`;
	if (sync.host_failed) return `${host} is not answering. ${last}`;
	if (sync.host_stale_seconds > 0) return `${read} Reading again.`;
	return read;
}

/** What the matchup panel says with no side for the drafter: a league with no current week has no
 * games, and a week we hold no game for is a read we could not make, never a claim about the team. */
export function matchupGap(sync: LeagueSync, now: Date): string {
	if (sync.week === 0) return 'Your league has no games this week.';
	return `We could not read this week's game from ${hostWords(sync.host)}. ${readLine(sync, now)}`;
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

/** A move as a sentence, with no closing period: "Alpha and Beta traded. Alpha got X, Beta got Y",
 * "Alpha claimed X and dropped Y". The list leads it with its day. */
export function moveWords(sync: LeagueSync, move: LeagueMove): string {
	const names = (list: LeagueMove['adds']): string => list.map((m) => m.player.name).join(', ');
	if (move.kind === 'trade') {
		const [a = 0, b = 0] = move.roster_ids;
		const toA = move.adds.filter((m) => m.roster_id === a);
		const toB = move.adds.filter((m) => m.roster_id === b);
		const [nameA, nameB] = [teamName(sync, a), teamName(sync, b)];
		return `${nameA} and ${nameB} traded. ${nameA} got ${names(toA) || 'nobody'}, ${nameB} got ${names(toB) || 'nobody'}`;
	}
	const who = teamName(sync, move.roster_ids[0] ?? 0);
	const how = move.kind === 'waiver' ? 'claimed' : 'picked up';
	const added = move.adds.length > 0 ? `${how} ${names(move.adds)}` : '';
	const dropped = move.drops.length > 0 ? `dropped ${names(move.drops)}` : '';
	return `${who} ${[added, dropped].filter((part) => part !== '').join(' and ')}`;
}

/** His season so far with its basis: "5 games, 18.4 a game", or "No games yet". */
export function seasonWords(season: IndexSeason): string {
	if (season.pointsPerGame === null) return 'No games yet';
	// A negative figure takes the minus sign, as every other negative on the page does.
	const figure =
		season.pointsPerGame < 0
			? signed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS)
			: fixed(season.pointsPerGame, POINTS_PER_GAME_DECIMALS);
	return `${plural(season.games, 'game')}, ${figure} a game`;
}

/** His preseason numbers with their basis: "proj 288, over repl +61". */
export function projectionWords(player: { points: number | null; vor: number | null }): string {
	const parts = [
		player.points === null ? null : `proj ${fixed(player.points, 0)}`,
		player.vor === null ? null : `over repl ${signed(player.vor, 0)}`
	];
	return parts.filter((part) => part !== null).join(', ');
}

/** A league player as a board row: the board's numbers when we placed him, the host's own name,
 * position and team when we did not. */
export function rowOf(board: LeagueBoard, player: LeaguePlayer): LeagueBoardPlayer | null {
	if (player.board_id !== null) {
		const placed = board.byId.get(player.board_id);
		if (placed) return placed;
	}
	return null;
}

/** Whether the season has kicked off on the run's board: any player has a game. */
export function seasonStarted(board: LeagueBoard): boolean {
	return board.players.some((p) => p.season.games > 0);
}

/** Before kickoff our board's order (points over replacement); after, points a game this season,
 * best first, a player with no game after every one with one, ties by the preseason projection. */
function poolOrder(a: LeagueBoardPlayer, b: LeagueBoardPlayer): number {
	const ppg = (p: LeagueBoardPlayer): number => p.season.pointsPerGame ?? Number.NEGATIVE_INFINITY;
	return ppg(b) - ppg(a) || (b.points ?? 0) - (a.points ?? 0);
}

/** The waiver pool: our board without every player a team in the league holds, ranked as
 * poolBasis says. */
export function poolRows(board: LeagueBoard, sync: LeagueSync): readonly LeagueBoardPlayer[] {
	const held = new Set(sync.rostered);
	const pool = board.players.filter((p) => !held.has(p.id));
	return seasonStarted(board) ? pool.toSorted(poolOrder) : pool;
}

/** How the pool is ranked, said once above it. */
export function poolBasis(board: LeagueBoard): string {
	return seasonStarted(board)
		? 'Unrostered in your league, ranked by points a game this season, then by our preseason projection.'
		: "Unrostered in your league, ranked by our preseason board's points over replacement.";
}

/** The page's one basis line: which scoring the figures are in, and, when the league scores
 * otherwise and the account lacks its exact rules, where those come from. */
export function figuresLine(
	boardFormat: BoardFormat,
	scoringLike: ScoringPreset,
	exactRules: boolean
): string {
	const figures = `Figures are ${FORMAT_LABELS[boardFormat]}.`;
	if (exactRules || scoringLike === boardFormat) return figures;
	return `${figures} Your league scores ${FORMAT_LABELS[scoringLike]}, and its exact rules come with the Draft Pass.`;
}

/** The kicker and defense the league starts that the run's board does not rank, said as the pool's
 * missing chips: "No kickers on this run." */
export function missingFromRun(sync: LeagueSync, board: LeagueBoard): readonly string[] {
	const ranked = new Set(board.players.map((p) => p.position as string));
	const held = new Set(sync.roster.map((s) => s.player.position));
	const words: Readonly<Record<string, string>> = { K: 'kickers', DEF: 'defenses' };
	return Object.entries(words)
		.filter(([pos]) => held.has(pos) && !ranked.has(pos))
		.map(([, plural]) => `No ${plural} on this run.`);
}

/** The drafter's team. */
export function myTeam(sync: LeagueSync): LeagueTeam | undefined {
	return sync.teams.find((t) => t.roster_id === sync.me);
}

/** The drafter's place in the standings, 1-based. */
export function myPlace(sync: LeagueSync): number {
	return sync.teams.findIndex((t) => t.roster_id === sync.me) + 1;
}

/** The mark a roster slot puts on a player's face: injured reserve, or none. */
export function slotStatus(slot: RosterSpot['slot']): FaceStatus | null {
	return slot === 'reserve' ? 'ir' : null;
}

/** The mark on a player's face from the roster that holds him, none when it does not. */
export function statusOn(roster: readonly RosterSpot[], hostId: string): FaceStatus | null {
	const spot = roster.find((s) => s.player.host_id === hostId);
	return spot ? slotStatus(spot.slot) : null;
}
