// The run the one-value shots build from (Lane 220, B184): the one-board run (one-board-run.ts, made
// Thursday morning of week 6) with its PPR board cut to the players the fixture API's order places
// (order.json), so a club page, compare and the clubs index can read every one of their players at the
// order's clock, as on a real run, where the API's order and the board hold the same players. Written to
// web/.runs/runs/2026-10-15T13-onevalue (never committed); the stand-in's latest.json is left as is.
// STAND-INS, named here and in the report: the board holds the order's 112 players only (the stand-in's
// other ranked players are dropped with their pages, index entries and designations), renumbered in the
// one-board run's order; each kept player's page carries his board row's PPR figures, as a real run's
// pages carry the board's.
//
//   node scripts/inseason-fixture/one-board-run.ts && node scripts/inseason-fixture/one-value-run.ts
// then build with PUBLIC_RUN_ID=2026-10-15T13-onevalue PUBLIC_RUN_BASE_URL=.runs and start the fixture
// API with FIXTURE_RUN_ID=2026-10-15T13-onevalue.
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { ONE_BOARD_RUN_ID, ONE_VALUE_RUN_ID } from './run-ids.ts';

const FORMAT = 'ppr-12';
const TEAMS = 12;
const MARKET = 'market';
/** The board row's fields a player page's format carries. */
const PAGE_FIELDS = ['positionRank', 'ourRank', 'vorRound', 'projected', 'vor', 'tier'] as const;
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const OUT = new URL(`${ONE_VALUE_RUN_ID}/`, RUNS);

type Json = Record<string, unknown>;
interface OrderRow {
	rest_of_season_points: number | null;
	points_over_replacement: number | null;
	line: { player: { board_id: string | null } };
}

const readJson = async (url: URL): Promise<Json> => JSON.parse(await readFile(url, 'utf8')) as Json;
await cp(new URL(`${ONE_BOARD_RUN_ID}/`, RUNS), OUT, { recursive: true });

const order = (await readJson(new URL('./data/order.json', import.meta.url))) as unknown as {
	rows: OrderRow[];
};
const placed = new Set(
	order.rows
		.filter((row) => row.rest_of_season_points !== null && row.points_over_replacement !== null)
		.flatMap((row) => (row.line.player.board_id === null ? [] : [row.line.player.board_id]))
);
const boardUrl = new URL(`boards/${FORMAT}.json`, OUT);
const board = await readJson(boardUrl);
const all = board.rows as Json[];
const market = all.filter((row) => row.orderBasis === MARKET);
const dropped = new Set(
	all
		.filter((row) => row.orderBasis !== MARKET && !placed.has(String(row.id)))
		.map((row) => String(row.id))
);
const kept = all
	.filter((row) => row.orderBasis !== MARKET && placed.has(String(row.id)))
	.map((row, i): Json => ({ ...row, ourRank: i + 1, vorRound: Math.ceil((i + 1) / TEAMS) }));
// Each position's places again among the kept rows, in the board's order.
const atPosition = new Map<string, number>();
const ranked = kept.map((row): Json => {
	const place = (atPosition.get(String(row.position)) ?? 0) + 1;
	atPosition.set(String(row.position), place);
	return { ...row, positionRank: place };
});
board.rows = [...ranked, ...market.map((row, i) => ({ ...row, ourRank: ranked.length + i + 1 }))];
await writeFile(boardUrl, JSON.stringify(board));

// A kept player's page carries his board row's PPR figures.
const byId = new Map(ranked.map((row) => [String(row.id), row]));
for (const file of await readdir(new URL('players/', OUT))) {
	const url = new URL(`players/${file}`, OUT);
	const page = await readJson(url);
	if (dropped.has(String(page.id))) {
		await rm(url);
		continue;
	}
	const row = byId.get(String(page.id));
	const formats = page.formats as Record<string, Json>;
	const numbers = formats[FORMAT];
	if (row === undefined || numbers === undefined) continue;
	formats[FORMAT] = {
		...numbers,
		...Object.fromEntries(PAGE_FIELDS.map((field) => [field, row[field]])),
		gap: null
	};
	await writeFile(url, JSON.stringify(page));
}

// The index and the injury capture name only the players the run keeps.
const indexUrl = new URL('index.json', OUT);
const index = JSON.parse(await readFile(indexUrl, 'utf8')) as Json[];
await writeFile(indexUrl, JSON.stringify(index.filter((entry) => !dropped.has(String(entry.id)))));
const designationsUrl = new URL('designations.json', OUT);
const designations = await readJson(designationsUrl);
designations.players = Object.fromEntries(
	Object.entries(designations.players as Json).filter(([id]) => !dropped.has(id))
);
await writeFile(designationsUrl, JSON.stringify(designations));

const manifestUrl = new URL('manifest.json', OUT);
const manifest = await readJson(manifestUrl);
manifest.runId = ONE_VALUE_RUN_ID;
manifest.players = Number(manifest.players) - dropped.size;
await writeFile(manifestUrl, JSON.stringify(manifest));
process.stdout.write(
	`${ONE_VALUE_RUN_ID}: ${String(ranked.length)} ranked rows, ${OUT.pathname}\n`
);
