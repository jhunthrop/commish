/** What the league page reads off a sync: the host's name as a mechanism, the read's age, a team's
 * record, a move in words, and the drafter's roster and the pool as board players. Pure functions
 * over the API's answer. */
import { fixed, plural, signed } from '#lib/format/number.ts';
import { midSentence } from '#lib/format/sentence.ts';
import { POINTS_PER_GAME_DECIMALS } from '#lib/run/decimals.ts';
import type { IndexSeason } from '#lib/run/schema.ts';
import type { LeagueBoard, LeagueBoardPlayer } from './board.ts';
import type { FaceStatus } from '#lib/ui/face-status.ts';
import type {
	AttachedLeague,
	LeagueMatchup,
	LeagueHost,
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

export { IN_SEASON_TOOLS_LINE, LEAGUE_HOSTS, hostsLine } from './hosts.ts';

const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;

/** How long ago a read was: "just now", "4 minutes ago", "2 hours ago". */
export function agoWords(seconds: number): string {
	if (seconds < MINUTE * SECOND) return 'just now';
	if (seconds < HOUR) return `${plural(Math.floor(seconds / MINUTE), 'minute')} ago`;
	return `${plural(Math.floor(seconds / HOUR), 'hour')} ago`;
}

/** Seconds since a read, never below 0. */
function readAge(readAt: string, now: Date): number {
	return Math.max(0, (now.getTime() - Date.parse(readAt)) / 1000);
}

/** The verb that reads the league from its host again: "Read Sleeper now". */
export function readNowWords(host: LeagueHost): string {
	return `Read ${hostWords(host)} now`;
}

/** The read-again verb while the host is read. */
export const READING_NOW = 'Reading';

/** "Read from Sleeper 4 minutes ago.": when the host was last read for the league. */
export function readAgoLine(host: LeagueHost, readAt: string, now: Date): string {
	return `Read from ${hostWords(host)} ${agoWords(readAge(readAt, now))}.`;
}

/** What the read's line reads off a sync. */
type ReadState = Pick<
	LeagueSync,
	'host' | 'read_at' | 'host_signed_out' | 'host_failed' | 'host_stale_seconds'
>;

/** The read's line: when the host was last read, and, when the last read failed, why, and that this
 * is the last read we have. A kept read waiting on the next one names no failure. A league read as a
 * member is read with the drafter's own sign-in alone, so a lapsed one is theirs to connect again. */
export function readLine(sync: ReadState, now: Date): string {
	const age = readAge(sync.read_at, now);
	const host = hostWords(sync.host);
	const read = readAgoLine(sync.host, sync.read_at, now);
	const last = `This is our last read, ${agoWords(age)}.`;
	if (sync.host_signed_out) {
		return `Connect ${host} to keep this league in sync. ${last}`;
	}
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
export function standingWords(league: Pick<AttachedLeague, 'standing'>): string {
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
export function teamName(sync: Pick<LeagueSync, 'teams'>, rosterId: number): string {
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

/** His preseason numbers with their basis: "proj 288, over repl +61 a season" (a season, apart from
 * the in-season screens' figures a week), or for a player at his
 * position's depth floor, "below our board's depth". */
export function projectionWords(player: {
	points: number | null;
	vor: number | null;
	belowDepth?: boolean;
}): string {
	if (player.belowDepth === true) return "below our board's depth";
	const parts = [
		player.points === null ? null : `proj ${fixed(player.points, 0)}`,
		player.vor === null ? null : `over repl ${signed(player.vor, 0)} a season`
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

/** The page's one basis line, once: the scoring the figures are in (the run's season scoring, never
 * a lineup shape such as superflex), which figures are this season's and which are preseason, in
 * words, and the league's own scoring in plain words when it differs: "PPR. This season's games and
 * points a game through week 5, beside our preseason projection and points over replacement. Your
 * league gives tight ends extra points per catch." The league's sentence is note-words'
 * scoresSentence, handed in so this module never pulls the league line in. No page promises the
 * league's exact rules here. */
export function leagueBasis(
	figuresScoring: string,
	through: number,
	scoringLike: ScoringPreset,
	scoresSentence: (scoring: ScoringPreset) => string
): string {
	const reach = through === 0 ? '' : ` through week ${String(through)}`;
	const same =
		midSentence(figuresScoring).toLowerCase() === SCORING_WORDS[scoringLike].toLowerCase();
	const own = same ? '' : ` ${scoresSentence(scoringLike)}`;
	return `${figuresScoring}. This season's games and points a game${reach}, beside our preseason projection and points over replacement.${own}`;
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
