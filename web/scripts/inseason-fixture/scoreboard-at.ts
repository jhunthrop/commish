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
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';

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

/** Every line the recorded answers hold, by host id: each starter's game and projection. */
export function linesOf(answers: {
	lineup: LineupAdvice;
	waivers: WaiverAdvice;
	trades: TradeAdvice;
	matchup: MatchupBox;
}): Map<string, PlayerLine> {
	const out = new Map<string, PlayerLine>();
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
	final: number;
	games: number;
	next: string | null;
}

function kicks(lines: readonly PlayerLine[], moment: Moment): Kicks {
	const out: Kicks = { kicked: 0, final: 0, games: 0, next: null };
	for (const line of lines) {
		const { facts } = line;
		if (facts.bye || facts.kickoff === null) continue;
		out.games++;
		const at = Date.parse(facts.kickoff);
		const final = moment.final(line);
		if (final) out.final++;
		if (final || at <= moment.now) {
			out.kicked++;
			continue;
		}
		if (out.next === null || at < Date.parse(out.next)) out.next = facts.kickoff;
	}
	return out;
}

function stateOf(k: Kicks): ScoreboardGame['state'] {
	if (k.kicked === 0) return 'upcoming';
	return k.final === k.games ? 'final' : 'playing';
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
			return {
				roster_id: m.roster_id,
				points: moment.scored
					? tenth(scored.reduce((n, l) => n + (l.week_projection ?? 0) * SCORED_SHARE, 0))
					: m.points,
				points_read: true,
				projection:
					projected.length === 0
						? null
						: tenth(projected.reduce((n, l) => n + tenth(l.week_projection ?? 0), 0)),
				starters: m.starters.filter((id) => id !== '0').length,
				played: kicks(lines, moment).kicked
			};
		});
		const game = kicks(all, moment);
		const state = stateOf(game);
		// The API's count (scoreboard.go toPlay): starters with a game, a bye starter left out.
		const toPlay =
			state === 'playing'
				? `${String(game.games - game.kicked)} of ${String(game.games)} starters to play`
				: null;
		return { state, next_kickoff: game.next, to_play: toPlay, sides };
	});
	return {
		week: recorded.week,
		read_at: readAt,
		projection_read_at: recorded.box.projection_read_at,
		projection_scoring: recorded.box.projection_scoring,
		games: [...games].sort((a, b) => mine(b.sides[0]?.roster_id) - mine(a.sides[0]?.roster_id))
	};
}
