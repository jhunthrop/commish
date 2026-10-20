// The run the one-board shots build from (Lane 96 fix round 1, B08): the stand-in run made in season
// on Thursday morning of week 6, its PPR board led by the fixture API's order (order.json), so the
// front door's strip finds every player the API ranks first. Written to
// web/.runs/runs/2026-10-15T13-oneboard (never committed); the stand-in's latest.json is left as is.
// STAND-INS, named here and in the report: the strip's rows are order.json's, at the figures it
// stores (its Projected before Thursday's game, its Over repl. as stored), and its first player whose
// club played Thursday (THURSDAY_PLAYER, review R1-L3) sits tenth on the run with his Thursday game
// counted and the tenth row's Over repl.; the fixture API on the Saturday clock takes Thursday's game
// out and ranks him where order.json does, so a signed-in reader's strip and the signed-out one differ
// by that game, as the API's live board and the run do. Every round is the run's rule, his place over
// the teams. The board's other rows are the stand-in's preseason figures, which no shot prints.
//
//   node scripts/inseason-fixture/one-board-run.ts
// then build with PUBLIC_RUN_ID=2026-10-15T13-oneboard PUBLIC_RUN_BASE_URL=.runs and start the
// fixture API with FIXTURE_RUN_ID=2026-10-15T13-oneboard.
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { restFromWords } from '../../src/lib/run/rest-from.ts';

export const ONE_BOARD_RUN_ID = '2026-10-15T13-oneboard';
/** Thursday Oct 15 2026, 8:50 am Central: before week 6's Thursday game. */
const RUN_AT = '2026-10-15T13:50:00.000Z';
const FIRST_WEEK = 6;
const LINES_THROUGH = 5;
const FORMAT = 'ppr-12';
const TEAMS = 12;
/** The run's place for the Thursday player: the strip's last row. */
const THURSDAY_PLACE = 9;
/** Before the fixture week's Thursday game ends: a kickoff before this is Thursday's. */
const THURSDAY_ENDS = '2026-10-16T12:00:00.000Z';
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const OUT = new URL(`${ONE_BOARD_RUN_ID}/`, RUNS);

type Json = Record<string, unknown>;
interface OrderRow {
	rank: number;
	rest_of_season_points: number | null;
	points_over_replacement: number | null;
	line: {
		player: { board_id: string | null };
		rest_of_season_per_game: number | null;
		facts: { kickoff: string | null };
	};
}

const readJson = async (url: URL): Promise<Json> => JSON.parse(await readFile(url, 'utf8')) as Json;
const { runId } = (await readJson(new URL('latest.json', RUNS))) as { runId: string };
await cp(new URL(`${runId}/`, RUNS), OUT, { recursive: true });

const order = (await readJson(new URL('./data/order.json', import.meta.url))) as unknown as {
	rows: OrderRow[];
};
const boardUrl = new URL(`boards/${FORMAT}.json`, OUT);
const board = await readJson(boardUrl);
const rows = board.rows as Json[];
const byId = new Map(rows.map((row) => [String(row.id), row]));
const led: Json[] = [];
let thursday: Json | null = null;
for (const row of order.rows) {
	const id = row.line.player.board_id;
	const stored = id === null ? undefined : byId.get(id);
	if (
		stored === undefined ||
		row.rest_of_season_points === null ||
		row.points_over_replacement === null
	) {
		continue;
	}
	const kickoff = row.line.facts.kickoff;
	const perGame = row.line.rest_of_season_per_game;
	const played = kickoff !== null && kickoff < THURSDAY_ENDS && perGame !== null;
	const numbers = {
		...stored,
		// The run, made before Thursday's game, counts it.
		projected: played ? row.rest_of_season_points + perGame : row.rest_of_season_points,
		vor: row.points_over_replacement,
		floor: null,
		median: null,
		ceiling: null,
		preseasonRank: stored.ourRank,
		preseasonPoints: stored.projected,
		restFromWeek: FIRST_WEEK
	};
	if (played && thursday === null && row.rank > THURSDAY_PLACE + 1) thursday = numbers;
	else led.push(numbers);
	byId.delete(id ?? '');
}
if (thursday !== null) {
	const tenth = led[THURSDAY_PLACE];
	led.splice(THURSDAY_PLACE, 0, { ...thursday, vor: tenth?.vor ?? thursday.vor });
}
// The rest keep their stand-in figures, each with his preseason place, as an in-season row carries it.
const rest = rows
	.filter((row) => byId.has(String(row.id)))
	.map((row) => ({
		...row,
		preseasonRank: row.ourRank,
		preseasonPoints: row.projected,
		restFromWeek: FIRST_WEEK
	}));
board.rows = [...led, ...rest].map((row, i) => ({
	...row,
	ourRank: i + 1,
	vorRound: Math.ceil((i + 1) / TEAMS)
}));
await writeFile(boardUrl, JSON.stringify(board));

// Each player page's PPR numbers in season: his preseason place beside them, as the board's rows.
for (const file of await readdir(new URL('players/', OUT))) {
	const url = new URL(`players/${file}`, OUT);
	const page = await readJson(url);
	const formats = page.formats as Record<string, Json>;
	const numbers = formats[FORMAT];
	if (numbers === undefined) continue;
	formats[FORMAT] = {
		...numbers,
		preseasonRank: numbers.ourRank,
		preseasonPoints: numbers.projected,
		restFromWeek: FIRST_WEEK
	};
	await writeFile(url, JSON.stringify(page));
}

const manifestUrl = new URL('manifest.json', OUT);
const manifest = await readJson(manifestUrl);
manifest.runId = ONE_BOARD_RUN_ID;
manifest.runAt = RUN_AT;
manifest.formats = (manifest.formats as Json[]).map((f) =>
	f.id === FORMAT
		? {
				...f,
				basis: [
					`PPR, rest of the 2026 season ${restFromWords(FIRST_WEEK, false)}, refreshed October 15`,
					'ranked by points over replacement in a 12-team league',
					'tiers drawn within each position'
				],
				rosFromWeek: FIRST_WEEK,
				rosFromWeekPartial: false,
				rosThroughWeek: LINES_THROUGH,
				refreshedAt: RUN_AT
			}
		: f
);
await writeFile(manifestUrl, JSON.stringify(manifest));
process.stdout.write(
	`${ONE_BOARD_RUN_ID}: ${String(led.length)} order rows lead, ${OUT.pathname}\n`
);
