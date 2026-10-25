// The fixture's scoreboard at an instant (Lane 66i, Lane 85): GET /leagues/attached/{id}/scoreboard as
// the API answers it (inseason scoreboard.go), from the recorded Sleeper matchups and the lines the
// other answers hold for each starter (a starter no answer lists counts nothing). A game's state is
// read from its starters' games by a rule given (the recorded read's, the Sunday stand-in's or the
// API's gameStateAt at the fixture's clock), its next kickoff the earliest still to come. Each side's
// points are the recorded ones, or the stand-in's scored share of each kicked-off starter's
// projection (sunday.ts SCORED_SHARE). league.ts writes scoreboard.json and scoreboard-live.json by
// it; serve.ts restates the week at its clock by it.
import { readFile } from 'node:fs/promises';
import type {
	GameState,
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import { roundTenth } from './tenths.ts';

type ScoreboardGame = Scoreboard['games'][number];

/** The share of a kicked-off player's projection the stand-in counts as scored. */
export const SCORED_SHARE = 0.85;
const TENTH = 10;
const tenth = (n: number): number => Math.round(n * TENTH) / TENTH;

/** One side of the recorded week as Sleeper's matchups read it. */
export interface SleeperMatchup {
	roster_id: number;
	matchup_id: number | null;
	starters: string[];
	/** Every player on the roster, starters and bench: FFPC's rosters page's list (Lane 125). */
	players: string[];
	points: number;
}

const REPLAY = new URL(
	'../../../api/internal/leaguesync/replay/sleeper/matchups.json',
	import.meta.url
);

/** The recorded week's matchups (the Sleeper replay the API's league read is tested on). */
export async function recordedMatchups(): Promise<SleeperMatchup[]> {
	return JSON.parse(await readFile(REPLAY, 'utf8')) as SleeperMatchup[];
}

/** Every line the recorded answers hold, by host id: each starter's game and projection; `extra`
 * first (the other game's full lines, other-game-lines.ts), the answers' own lines over them. */
export function linesOf(
	answers: {
		lineup: LineupAdvice;
		waivers: WaiverAdvice;
		trades: TradeAdvice;
		matchup: MatchupBox;
	},
	extra: readonly PlayerLine[] = []
): Map<string, PlayerLine> {
	const out = new Map<string, PlayerLine>(extra.map((line) => [line.player.host_id, line]));
	const remember = (line: PlayerLine | null | undefined): void => {
		if (line) out.set(line.player.host_id, line);
	};
	const { lineup, waivers, trades, matchup } = answers;
	trades.teams.forEach((t) => {
		t.roster.forEach(remember);
	});
	trades.roster.forEach(remember);
	waivers.rows.forEach((r) => {
		remember(r.add);
		remember(r.drop);
	});
	[...lineup.slots.flatMap((s) => [s.ours, s.host]), ...lineup.bench, ...lineup.reserve].forEach(
		remember
	);
	matchup.sides.forEach((s) => {
		s.starters.forEach((st) => {
			remember(st.line);
		});
		s.bench.forEach(remember);
	});
	return out;
}

/** How a moment reads a starter's game: final by its rule, kicked off once its kickoff has passed. */
export interface Moment {
	now: number;
	final: (line: PlayerLine) => boolean;
	/** Each side's points: the recorded ones, or the stand-in's scored share. */
	scored: boolean;
}

interface Kicks {
	kicked: number;
	/** Final, or out (a designation that keeps him out) however his game stands (Lane 92). */
	done: number;
	/** Final at the moment (moment.final), the side's Final when every game is (Lane 121). */
	finals: number;
	inPlay: number;
	toCome: number;
	games: number;
	next: string | null;
}

/** A designation that keeps him out this week (scoreboard.go sitsOut, the web's sitsHim). */
export function sitsOut(line: PlayerLine): boolean {
	const status = line.facts.designation?.status;
	return status !== undefined && status !== 'questionable' && status !== 'doubtful';
}

function kicks(lines: readonly PlayerLine[], moment: Pick<Moment, 'now' | 'final'>): Kicks {
	const out: Kicks = { kicked: 0, done: 0, finals: 0, inPlay: 0, toCome: 0, games: 0, next: null };
	for (const line of lines) {
		const { facts } = line;
		if (facts.bye || facts.kickoff === null) continue;
		out.games++;
		const at = Date.parse(facts.kickoff);
		const final = moment.final(line);
		if (final) out.finals++;
		const sits = sitsOut(line);
		if (final || at <= moment.now) {
			out.kicked++;
			if (final || sits) out.done++;
			else out.inPlay++;
			continue;
		}
		// Out with his game still to come: still to play (fix round 1, HIGH-2).
		out.toCome++;
		if (out.next === null || at < Date.parse(out.next)) out.next = facts.kickoff;
	}
	return out;
}

function stateOf(k: Kicks): ScoreboardGame['state'] {
	if (k.kicked === 0) return 'upcoming';
	return k.done === k.games ? 'final' : 'playing';
}

/** A side's state by the schedule (schedule_state.go scheduleState, Lane 124 B102), for a side the
 * platform lists no starters for: its roster's games, final once every one is, kicked off once one
 * has kicked off, upcoming before. */
export function scheduleStateOf(
	roster: readonly PlayerLine[],
	moment: Pick<Moment, 'now' | 'final'>
): GameState {
	const k = kicks(roster, moment);
	if (k.games > 0 && k.finals === k.games) return 'final';
	return k.kicked > 0 ? 'kicked_off' : 'upcoming';
}

/** A schedule's state as a game's (schedule_state.go scheduleGame). */
const SCHEDULE_GAME: Readonly<Record<GameState, ScoreboardGame['state']>> = {
	upcoming: 'upcoming',
	kicked_off: 'playing',
	final: 'final'
};

/** A game's state by each side's own rule (schedule_state.go gameState, Lane 124 B102): its listed
 * starters' games, never final while a side listing none (`unlisted`, each side's schedule lines) is
 * not final by the schedule; the next kickoff the listed starters'. A game none of whose sides lists
 * a starter with a game reads by the schedule alone, its next kickoff the schedule's (Lane 125, B104:
 * every other game of FFPC's scoreboard). */
export function listedGameOf(
	listed: readonly PlayerLine[],
	unlisted: readonly (readonly PlayerLine[])[],
	moment: Pick<Moment, 'now' | 'final'>
): Pick<ScoreboardGame, 'state' | 'next_kickoff'> {
	const k = kicks(listed, moment);
	if (k.games === 0 && unlisted.length > 0) {
		const all = unlisted.flat();
		return {
			state: SCHEDULE_GAME[scheduleStateOf(all, moment)],
			next_kickoff: kicks(all, moment).next
		};
	}
	const state = stateOf(k);
	const waiting =
		state === 'final' && unlisted.some((lines) => scheduleStateOf(lines, moment) !== 'final');
	return { state: waiting ? 'playing' : state, next_kickoff: k.next };
}

/** The count while the game is under way (words.go ToPlayWords), never a zero; null otherwise. */
function toPlayOf(k: Kicks, state: ScoreboardGame['state']): string | null {
	if (state !== 'playing') return null;
	if (k.toCome > 0) return `${String(k.toCome)} to play`;
	if (k.inPlay > 0) return `${String(k.inPlay)} playing`;
	return null;
}

/** A side's projected final (projfinal.go projectedFinal): its points so far, plus for each starter
 * in play the rest of his Proj (max(0, Proj - his points), none without his points), plus the Proj of
 * each starter still to play, each as printed, an out starter counting nothing; null before the game
 * has kicked off (started), with no points, or while a starter still to play has no Proj. */
export function projectedFinalOf(
	points: number | null,
	lines: readonly PlayerLine[],
	moment: Pick<Moment, 'now' | 'final'>,
	started: boolean,
	pointsOf: (line: PlayerLine) => number | null = (line) => line.facts.points_this_week
): number | null {
	if (points === null || !started) return null;
	let sum = points;
	for (const line of lines) {
		if (line.facts.bye || line.facts.kickoff === null || sitsOut(line)) continue;
		if (kickedOffAt(line, moment.now)) {
			const pts = pointsOf(line);
			if (!moment.final(line) && pts !== null && line.week_projection !== null)
				sum += Math.max(0, tenth(line.week_projection) - pts);
			continue;
		}
		if (line.week_projection === null) return null;
		sum += tenth(line.week_projection);
	}
	return tenth(sum);
}

/** Each side's count by its starters' lines while the game is playing (matchup.go, the score bug's
 * rule), null otherwise. */
export function countsOf(
	sides: readonly (readonly PlayerLine[])[],
	moment: Pick<Moment, 'now' | 'final'>
): (string | null)[] {
	const m = { ...moment, scored: false };
	const state = stateOf(kicks(sides.flat(), m));
	return sides.map((lines) => toPlayOf(kicks(lines, m), state));
}

/** Whether any of the lines has kicked off at `now`. */
export function anyKickedAt(lines: readonly PlayerLine[], now: number): boolean {
	return lines.some((l) => kickedOffAt(l, now));
}

/** Whether a line has kicked off at `now`: the stand-in's scored share counts from then. */
export function kickedOffAt(line: PlayerLine, now: number): boolean {
	const { bye, kickoff } = line.facts;
	return !bye && kickoff !== null && Date.parse(kickoff) <= now;
}

export interface Recorded {
	me: number;
	week: number;
	matchups: readonly SleeperMatchup[];
	lines: ReadonlyMap<string, PlayerLine>;
	box: Pick<MatchupBox, 'projection_read_at' | 'projection_scoring'>;
}

/** The week's scoreboard at a moment, the drafter's game first, read at `readAt`. */
export function scoreboardAt(recorded: Recorded, moment: Moment, readAt: string): Scoreboard {
	const byGame = new Map<number, SleeperMatchup[]>();
	for (const m of recorded.matchups) {
		const game = m.matchup_id ?? -m.roster_id;
		byGame.set(game, [...(byGame.get(game) ?? []), m]);
	}
	const mine = (roster: number | undefined): number => Number(roster === recorded.me);
	const games: ScoreboardGame[] = [...byGame.values()].map((recordedPair) => {
		const pair = [...recordedPair].sort((a, b) => mine(b.roster_id) - mine(a.roster_id));
		const all: PlayerLine[] = [];
		const sides = pair.map((m) => {
			const lines = m.starters
				.filter((id) => id !== '0')
				.map((id) => recorded.lines.get(id))
				.filter((l): l is PlayerLine => l !== undefined);
			all.push(...lines);
			const projected = lines.filter((l) => l.week_projection !== null);
			const scored = lines.filter((l) => kickedOffAt(l, moment.now) && l.week_projection !== null);
			const points = moment.scored
				? // Each starter's points to the tenth as his row prints them, then added: the one sum the
					// Matchup's Team prints (sideScore, Lane 79).
					roundTenth(
						scored.reduce((n, l) => n + roundTenth((l.week_projection ?? 0) * SCORED_SHARE), 0)
					)
				: m.points;
			return {
				roster_id: m.roster_id,
				points,
				points_read: true,
				projection:
					projected.length === 0
						? null
						: tenth(projected.reduce((n, l) => n + tenth(l.week_projection ?? 0), 0)),
				starters: m.starters.filter((id) => id !== '0').length,
				played: kicks(lines, moment).kicked,
				kicks: kicks(lines, moment),
				lines
			};
		});
		const game = kicks(all, moment);
		const state = stateOf(game);
		const started = game.kicked > 0;
		// The API's counts (scoreboard.go toPlay): the game's pooled, each side's own (Lane 92).
		return {
			state,
			next_kickoff: game.next,
			to_play: toPlayOf(game, state),
			sides: sides.map(({ kicks: own, lines, ...side }) => ({
				...side,
				// Each starter's points as the stand-in scores them (its scored share).
				projected_final: projectedFinalOf(side.points, lines, moment, started, (l) =>
					moment.scored && l.week_projection !== null
						? roundTenth(l.week_projection * SCORED_SHARE)
						: null
				),
				to_play: toPlayOf(own, state),
				// The starters in play now (scoreboard.go inPlayCount, Lane 102).
				in_play: own.inPlay,
				// Every starter with a game final (scoreboard.go startersFinal, Lane 121 fix round 1).
				starters_final: own.games > 0 && own.finals === own.games
			}))
		};
	});
	return {
		week: recorded.week,
		read_at: readAt,
		projection_read_at: recorded.box.projection_read_at,
		projection_scoring: recorded.box.projection_scoring,
		games: [...games].sort((a, b) => mine(b.sides[0]?.roster_id) - mine(a.sides[0]?.roster_id))
	};
}
