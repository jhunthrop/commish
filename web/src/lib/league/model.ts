/** What the league page reads off a sync: the host's name as a mechanism, the read's age, a team's
 * record, a move in words, and the drafter's roster and the pool as board players. Pure functions
 * over the API's answer. */
import { fixed, plural, signed } from '#lib/format/number.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { IndexSeason } from '#lib/run/schema.ts';
import type { LeagueBoard, LeagueBoardPlayer } from './board.ts';
import type { FaceStatus } from '#lib/ui/face-status.ts';
import type {
	AttachedLeague,
	LeagueMatchup,
	LeagueMove,
	LeaguePlayer,
	LeagueSync,
	LeagueTeam,
	MatchupSide,
	RosterSpot
} from './api.ts';
import type { components } from '#lib/api/types.ts';
import { SCORING_WORDS, hostWords } from './names.ts';

export { followedName, hostWords } from './names.ts';

type ScoringPreset = components['schemas']['ScoringPreset'];

/** How often an open league page reads the league again. The API reads the host at most once a
 * minute whatever the number of viewers, so a faster page would only see the same read. */
export const POLL_MS = 60_000;

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

/** The matchup head's aside: nothing when the drafter's score was not read (the panel says so),
 * points so far once a game is on or in an all-play week whose read score is the fact, and no games
 * played only when the read shows every side at 0. */
export function matchupAside(
	matchup: LeagueMatchup,
	allPlay: boolean,
	started: boolean
): string | undefined {
	if (scoreUnread(matchup.mine)) return undefined;
	return started || allPlay ? 'Points so far' : 'No games played yet';
}

/** The api said it could not read the side's score. Only an explicit false counts: an api that
 * predates points_read omits it, and its scores were read. */
export function scoreUnread(side: MatchupSide): boolean {
	return (side.points_read as boolean | undefined) === false;
}

/** What the panel says when the drafter's score for the week could not be read. */
export function scoreGap(sync: LeagueSync, now: Date): string {
	return `We could not read your score for this week from ${hostWords(sync.host)}. ${readLine(sync, now)}`;
}

/** "5-1", or "5-1-1" with ties. */
export function recordWords(team: Pick<LeagueTeam, 'wins' | 'losses' | 'ties'>): string {
	const base = `${String(team.wins)}-${String(team.losses)}`;
	return team.ties > 0 ? `${base}-${String(team.ties)}` : base;
}

/** Where the drafter stands in a followed league: "2-3, 9 of 12", empty before a read. */
export function standingWords(league: AttachedLeague): string {
	const s = league.standing;
	return s ? `${recordWords(s)}, ${String(s.place)} of ${String(s.teams)}` : '';
}

/** A followed league's line under its name, so two alike names part: "My Ball Zach Ertz, 2-3, 9
 * of 12, on FFPC". */
export function followedLine(league: AttachedLeague): string {
	const parts = [league.team_name, standingWords(league)].filter((p) => p !== '');
	return [...parts, `on ${hostWords(league.host)}`].join(', ');
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

/** His preseason numbers with their basis: "proj 288, over repl +61", or for a player at his
 * position's depth floor, "below our board's depth". */
export function projectionWords(player: {
	points: number | null;
	vor: number | null;
	belowDepth?: boolean;
}): string {
	if (player.belowDepth === true) return "below our board's depth";
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

/** The waiver pool: our board without every player a team in the league holds, in our board's
 * order (points over replacement), so a one-QB league's pickups lead rather than its backup
 * quarterbacks. In season each row shows his points a game. */
export function poolRows(board: LeagueBoard, sync: LeagueSync): readonly LeagueBoardPlayer[] {
	// An API from before held_by omits it and still names the rostered ids: read those then.
	const byId = sync.held_by as LeagueSync['held_by'] | undefined;
	// eslint-disable-next-line @typescript-eslint/no-deprecated -- the deploy window's fallback, removed with the field.
	const held = new Set(byId === undefined ? sync.rostered : Object.keys(byId));
	return board.players.filter((p) => !held.has(p.id));
}

/** How the pool is ranked and what its figure is, said once above it. */
export function poolBasis(board: LeagueBoard): string {
	const order =
		"Unrostered in your league, ranked by our preseason board's points over replacement.";
	return seasonStarted(board) ? `${order} The figure is his points a game this season.` : order;
}

/** A label in a sentence: a word drops its capital ("Half PPR" to "half PPR"), an acronym keeps it. */
function midSentence(label: string): string {
	return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** The page's one basis line: the scoring the figures are in (the run's season scoring, never a
 * lineup shape such as superflex) and the league's own: "Figures are PPR. Your league scores TE
 * premium." No page promises the league's exact rules until they ship. */
export function figuresLine(figuresScoring: string, scoringLike: ScoringPreset): string {
	const figures = midSentence(figuresScoring);
	const league = SCORING_WORDS[scoringLike];
	const same = figures.toLowerCase() === league.toLowerCase();
	return `Figures are ${figures}. Your league scores ${same ? 'the same' : league}.`;
}

/** The drafter's team. */
export function myTeam(sync: LeagueSync): LeagueTeam | undefined {
	return sync.teams.find((t) => t.roster_id === sync.me);
}

/** The drafter's place in the standings, 1-based. */
export function myPlace(sync: LeagueSync): number {
	return sync.teams.findIndex((t) => t.roster_id === sync.me) + 1;
}

/** The mark on a player's face: IR when the host says so, by his roster's IR slot or the IR it
 * writes beside his name; none otherwise, whatever slot he is on. */
export function spotStatus(spot: Pick<RosterSpot, 'slot' | 'player'>): FaceStatus | null {
	return spot.slot === 'reserve' || spot.player.injured_reserve ? 'ir' : null;
}

/** The mark on a player's face from the roster that holds him, else from his own word. */
export function statusOn(roster: readonly RosterSpot[], player: LeaguePlayer): FaceStatus | null {
	const spot = roster.find((s) => s.player.host_id === player.host_id);
	if (spot) return spotStatus(spot);
	return player.injured_reserve ? 'ir' : null;
}
