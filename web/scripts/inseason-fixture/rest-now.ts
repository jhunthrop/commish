/** The fixture API's rest of season at its clock (Lane 86), as the API's RestAt and LiveBoard
 * (api/internal/inseason/restlive.go) take it: the order's figures are from week 6 (order.ts), so a
 * player whose club's week 6 game is no longer upcoming at the clock, or whose club is on bye, counts
 * from week 7, his total his points a game times the games still to play; the order starts at the
 * earliest week with a game left and, while a game of it has kicked off, says it counts that week's
 * games left. The player read's rest of season comes from the run the site was built from, every
 * format of it at the clock, as the API's fillRest gives it (restformats.go). The words are the
 * site's one table's (figurewords/words.json, run/rest-from.ts). */
import { readFile } from 'node:fs/promises';
import type { components } from '../../src/lib/api/types.ts';
import { apiFormatOf } from '../../src/lib/run/format-ids.ts';
import { restFromWords } from '../../src/lib/run/rest-from.ts';
import type { BoardFormat } from '../../src/lib/sheet/model.ts';
import { stateAt } from './game-state.ts';
import { SCORED_SHARE } from './scoreboard-at.ts';
import { roundTenth } from './tenths.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = components['schemas']['OrderRow'];
type PlayerLine = components['schemas']['PlayerLine'];
type PlayerWeek = components['schemas']['PlayerWeek'];

/** The week the fixture's order.json counts from. */
export const ORDER_FROM_WEEK = 6;
const NEXT_WEEK = ORDER_FROM_WEEK + 1;

/** Whether his club's week 6 game is played or kicked off at `now` (a bye is no game to play). */
function weekPlayed(line: PlayerLine, now: number): boolean {
	const facts = line.facts as unknown as { bye?: boolean; kickoff: string | null; played: boolean };
	if (facts.bye === true) return true;
	return stateAt({ ...facts, team: line.player.team }, now) !== 'upcoming';
}

/** His line with his roster's points so far once his game has kicked off (Lane 92, the API's
 * boardPerson reads his roster's side): the stand-in's scored share of his projection (sunday.ts), for
 * a rostered player in a league's order alone; a free agent has none from the platform. */
function withRosterPoints(row: OrderRow, now: number): PlayerLine {
	const { line } = row;
	if (row.roster === null || row.roster.kind === 'free' || !weekPlayed(line, now)) return line;
	if (line.facts.bye || line.week_projection === null) return line;
	const points = roundTenth(line.week_projection * SCORED_SHARE);
	return { ...line, facts: { ...line.facts, points_this_week: points } };
}

/** His rest of season at `now` from his order row: the week it starts from and his total over the
 * games still to play, the order's from week 6 less a week 6 game kicked off since. */
export function restOfRow(
	row: Pick<OrderRow, 'line' | 'rest_of_season_points'>,
	now: number
): { points: number | null; fromWeek: number } {
	const played = weekPlayed(row.line, now);
	const perGame = row.line.rest_of_season_per_game;
	const points = row.rest_of_season_points;
	const fromWeek = played ? NEXT_WEEK : ORDER_FROM_WEEK;
	if (points === null || perGame === null || !played || row.line.facts.bye)
		return { points, fromWeek };
	return { points: roundTenth(points - perGame), fromWeek };
}

/** The order at `now`: each row's total over his club's games left, the order's first week
 * and its line said as the API says them. */
export function orderAtClock(order: OrderAdvice, now: number): OrderAdvice {
	const rows = order.rows.map((row) => ({
		...row,
		line: withRosterPoints(row, now),
		rest_of_season_points: restOfRow(row, now).points
	}));
	const played = order.rows.map((row) => weekPlayed(row.line, now));
	const fromWeek = played.every(Boolean) ? NEXT_WEEK : ORDER_FROM_WEEK;
	const partial = fromWeek === ORDER_FROM_WEEK && played.some(Boolean);
	const basis = order.basis.replace(
		/^Our rest-of-season order from week \d+\./,
		`Our rest-of-season order ${restFromWords(fromWeek, partial)}.`
	);
	return { ...order, basis, from_week: fromWeek, rows };
}

/** One club's games in the run's schedule.json. */
export interface RunSlate {
	abbr: string;
	games: { week: number; opponent: string | null; kickoff: string | null }[];
}

const LAST_WEEK = 17;

/** A club's weeks from `from` through week 17 whose game is upcoming at `at` by the API's rule. */
function weeksToPlay(slate: RunSlate, from: number, at: number): number[] {
	return slate.games
		.filter(
			(g) =>
				g.week >= from &&
				g.week <= LAST_WEEK &&
				g.kickoff !== null &&
				stateAt(
					{ played: false, kickoff: g.kickoff, team: slate.abbr, opponent: g.opponent },
					at
				) === 'upcoming'
		)
		.map((g) => g.week);
}

/** Each player's club and position from the built site's run (web/.runs, npm run standin), so the
 * league read places a player no recorded screen carries, as the API's board does. */
const RUNS = new URL('../../.runs/runs/', import.meta.url);
/** The run: the stand-in's latest, or FIXTURE_RUN_ID's (the Saturday run, saturday-run.ts). */
const RUN_ID = await (async (): Promise<string | null> => {
	const named = process.env.FIXTURE_RUN_ID;
	if (named !== undefined && named !== '') return named;
	try {
		return (JSON.parse(await readFile(new URL('latest.json', RUNS), 'utf8')) as { runId: string })
			.runId;
	} catch {
		return null;
	}
})();
const runDir = new URL(`${RUN_ID ?? ''}/`, RUNS);
const readRun = async <T>(path: string): Promise<T> =>
	JSON.parse(await readFile(new URL(path, runDir), 'utf8')) as T;

export const runIndex = await (async (): Promise<
	Map<string, { team: string; position: string }>
> => {
	try {
		const entries = await readRun<{ id: string; team: string; position: string }[]>('index.json');
		return new Map(entries.map(({ id, team, position }) => [id, { team, position }]));
	} catch {
		return new Map();
	}
})();

/** One run format's in-season rows: each player's club, points and points over replacement. */
interface FormatRows {
	format: BoardFormat;
	rows: Map<string, { team: string; projected: number; vor: number }>;
}

/** Every format the run carries, its rows and its schedule (Lane 86): null on a preseason run. */
const runRead = await (async (): Promise<{
	formats: FormatRows[];
	run: { fromWeek: number; at: number; slates: RunSlate[] };
} | null> => {
	try {
		const manifest = await readRun<{
			formats: { id: string; teams: number; rosFromWeek?: number; refreshedAt?: string }[];
		}>('manifest.json');
		const lead = manifest.formats[0];
		if (lead?.rosFromWeek === undefined || lead.refreshedAt === undefined) return null;
		const formats: FormatRows[] = [];
		for (const f of manifest.formats) {
			const format = apiFormatOf(f);
			if (format === null) continue;
			const board = await readRun<{
				rows: { id: string; team: string; projected: number | null; vor: number | null }[];
			}>(`boards/${f.id}.json`);
			const rows = new Map(
				board.rows.flatMap((r) =>
					r.projected === null || r.vor === null
						? []
						: [[r.id, { team: r.team, projected: r.projected, vor: r.vor }] as const]
				)
			);
			formats.push({ format, rows });
		}
		const { slates } = await readRun<{ slates: RunSlate[] }>('schedule.json');
		return {
			formats,
			run: { fromWeek: lead.rosFromWeek, at: Date.parse(lead.refreshedAt), slates }
		};
	} catch {
		return null;
	}
})();

/** His club's games still to play now over those at the run, the API's LiveBoard factor, and his
 * club's first week still to play now; null for a club the schedule lacks or with none at the run. */
function clubAtClock(team: string, now: number): { factor: number; from: number | null } | null {
	if (runRead === null) return null;
	const slate = runRead.run.slates.find((s) => s.abbr === team);
	if (slate === undefined) return null;
	const atRun = weeksToPlay(slate, runRead.run.fromWeek, runRead.run.at).length;
	const left = weeksToPlay(slate, runRead.run.fromWeek, now);
	return atRun === 0 ? null : { factor: left.length / atRun, from: left[0] ?? null };
}

/** The board's first week at `now` and whether a game of it has kicked off. */
function boardAtClock(now: number): { from: number | null; partial: boolean } {
	const slates = runRead?.run.slates ?? [];
	const from = runRead?.run.fromWeek ?? 1;
	const weeks = slates.flatMap((s) => weeksToPlay(s, from, now));
	const first = weeks.length === 0 ? null : Math.min(...weeks);
	const partial =
		first !== null &&
		slates.some((s) =>
			s.games.some(
				(g) => g.week === first && !weeksToPlay({ ...s, games: [g] }, first, now).includes(first)
			)
		);
	return { from: first, partial };
}

/** A run row's figures at `now`: points times his club's factor, Over repl. moved by as much (the
 * stand-in for the API's re-value, which moves the replacement level too). */
function rowAtClock(
	row: { team: string; projected: number; vor: number },
	now: number
): { points: number; vor: number } | null {
	const club = clubAtClock(row.team, now);
	if (club === null) return null;
	const points = roundTenth(row.projected * club.factor);
	return { points, vor: roundTenth(row.vor + points - row.projected) };
}

/** The tier box the read is asked for (?tier=, ?tier_next=, ?tier_format=). */
export interface TierAsk {
	ids: string[];
	next: string | null;
	format: BoardFormat;
}

/** The tier the page asks for, from the request's query; null when it asks none. */
export function tierAskOf(params: URLSearchParams): TierAsk | null {
	const ids = (params.get('tier') ?? '').split(',').filter((id) => id !== '');
	if (ids.length === 0) return null;
	return {
		ids,
		next: params.get('tier_next'),
		format: (params.get('tier_format') ?? 'ppr') as BoardFormat
	};
}

/** The player read's rest of season at `now`, as the API's fillRest answers it from the run the
 * site was built from: every format's figures, his week and the tier asked; nothing off the run. */
export function restAtClock(
	id: string,
	now: number,
	ask: TierAsk | null
): Pick<PlayerWeek, 'rest_of_season' | 'rest_from_week' | 'tier'> {
	const formats = runRead?.formats ?? [];
	const figures = formats.flatMap((f) => {
		const row = f.rows.get(id);
		const live = row === undefined ? null : rowAtClock(row, now);
		return live === null
			? []
			: [{ format: f.format, points: live.points, points_over_replacement: live.vor }];
	});
	const team = formats[0]?.rows.get(id)?.team;
	if (figures.length === 0 || team === undefined) return {};
	const from = clubAtClock(team, now)?.from ?? null;
	const out: Pick<PlayerWeek, 'rest_of_season' | 'rest_from_week' | 'tier'> = {
		rest_of_season: figures,
		...(from === null ? {} : { rest_from_week: from })
	};
	const board = formats.find((f) => f.format === ask?.format);
	if (ask === null || board === undefined) return out;
	const pointsOf = (mate: string): number | null => {
		const row = board.rows.get(mate);
		return row === undefined ? null : (rowAtClock(row, now)?.points ?? null);
	};
	const last = pointsOf(ask.ids.at(-1) ?? '');
	const next = ask.next === null ? null : pointsOf(ask.next);
	const clock = boardAtClock(now);
	return {
		...out,
		tier: {
			format: ask.format,
			mates: ask.ids.map((mate) => ({ board_id: mate, points: pointsOf(mate) })),
			drop: last === null || next === null ? null : roundTenth(last - next),
			from_week: clock.from,
			partial: clock.partial
		}
	};
}

/** His rest-of-season points a game at `now` in PPR, the API's rule (pergame.go RestOfSeasonPerGame):
 * his points now over his club's games left now; null with none left or off the run's order. */
export function restPerGameAtClock(id: string, now: number): number | null {
	const row = runRead?.formats.find((f) => f.format === 'ppr')?.rows.get(id);
	if (row === undefined || runRead === null) return null;
	const slate = runRead.run.slates.find((s) => s.abbr === row.team);
	const live = rowAtClock(row, now);
	const left = slate === undefined ? 0 : weeksToPlay(slate, runRead.run.fromWeek, now).length;
	return live === null || left === 0 ? null : roundTenth(live.points / left);
}
