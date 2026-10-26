// The run the one-number shots build from (Lane 234, B233): the one-value run (one-value-run.ts, the
// fixture order's players at the order's PPR figures) in three scorings, so a player page draws its
// every-format table and the fixture API answers a figure and a rank in each (restformats.go).
// Written to web/.runs/runs/2026-10-15T13-formats (never committed).
// STAND-INS, named here and in the report: half PPR and standard are the PPR board's figures times a
// share by position (a back keeps more of his points without catches than a receiver), less up to 6%
// by player (his id's last digit), so a position's order moves a little between scorings; each board
// is then ranked again (overall by Over repl., at a position by Projected) and each kept player's page
// carries his row's figures in every scoring.
//
//   node scripts/inseason-fixture/one-board-run.ts && node scripts/inseason-fixture/one-value-run.ts \
//     && node scripts/inseason-fixture/formats-run.ts
// then build with PUBLIC_RUN_ID=2026-10-15T13-formats PUBLIC_RUN_BASE_URL=.runs and start the fixture
// API with FIXTURE_RUN_ID=2026-10-15T13-formats.
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { FORMATS_RUN_ID, ONE_VALUE_RUN_ID } from './run-ids.ts';

type Json = Record<string, unknown>;

const SOURCE = 'ppr-12';
const TEAMS = 12;
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const OUT = new URL(`${FORMATS_RUN_ID}/`, RUNS);
const MARKET = 'market';
/** The share of his PPR points a player keeps in each scoring, by position (a stand-in). */
const SCORINGS = [
	{
		id: 'half-ppr-12',
		label: 'Half PPR',
		basisWord: 'Half PPR',
		share: { QB: 1, RB: 0.93, WR: 0.86, TE: 0.87 }
	},
	{
		id: 'standard-12',
		label: 'Standard',
		basisWord: 'Standard scoring',
		share: { QB: 1, RB: 0.86, WR: 0.72, TE: 0.74 }
	}
] as const;
/** The most a player's id takes off his share, in hundredths, by its last digit. */
const SPREAD = 6;
const DIGITS = 10;
const TENTH = 10;
/** The fields a player page's format carries from its board row. */
const PAGE_FIELDS = ['positionRank', 'ourRank', 'vorRound', 'projected', 'vor', 'gap'] as const;

const readJson = async (url: URL): Promise<Json> => JSON.parse(await readFile(url, 'utf8')) as Json;
const tenth = (value: number): number => Math.round(value * TENTH) / TENTH;

/** His share in a scoring: the position's, less his id's spread. */
function shareOf(row: Json, share: Readonly<Record<string, number>>): number {
	const digit = Number(String(row.id).at(-1) ?? 0);
	return (share[String(row.position)] ?? 1) - ((digit % DIGITS) * SPREAD) / (DIGITS * 100);
}

/** The PPR board in another scoring, ranked again: overall by Over repl., at a position by Projected;
 * the kickers and defenses after them as on the PPR board. */
function scoredBoard(rows: readonly Json[], share: Readonly<Record<string, number>>): Json[] {
	const ranked = rows
		.filter((row) => row.orderBasis !== MARKET)
		.map((row): Json & { projected: number; vor: number } => {
			const keep = shareOf(row, share);
			const projected = Number(row.projected);
			const points = tenth(projected * keep);
			return { ...row, projected: points, vor: tenth(Number(row.vor) - (projected - points)) };
		})
		.toSorted((a, b) => b.vor - a.vor)
		.map((row, i): Json => {
			const ourRank = i + 1;
			const adp = row.adp as number | null;
			return {
				...row,
				ourRank,
				vorRound: Math.ceil(ourRank / TEAMS),
				gap: adp === null ? null : tenth(adp - ourRank)
			};
		});
	const byPosition = new Map<string, Json[]>();
	for (const row of ranked) {
		const position = String(row.position);
		byPosition.set(position, [...(byPosition.get(position) ?? []), row]);
	}
	const places = new Map(
		[...byPosition.values()].flatMap((group) =>
			group
				.toSorted((a, b) => Number(b.projected) - Number(a.projected))
				.map((row, i) => [String(row.id), i + 1] as const)
		)
	);
	// The kickers and defenses keep their places after the ranked rows, as the PPR board has them.
	const market = rows
		.filter((row) => row.orderBasis === MARKET)
		.map((row, i) => ({ ...row, ourRank: ranked.length + i + 1 }));
	return [
		...ranked.map((row) => ({ ...row, positionRank: places.get(String(row.id)) })),
		...market
	];
}

// A run left from an earlier write is removed first, so no file of it outlives this one.
await rm(OUT, { recursive: true, force: true });
await cp(new URL(`${ONE_VALUE_RUN_ID}/`, RUNS), OUT, { recursive: true });

const ppr = await readJson(new URL(`boards/${SOURCE}.json`, OUT));
const boards = SCORINGS.map((scoring) => ({
	scoring,
	rows: scoredBoard(ppr.rows as Json[], scoring.share)
}));
for (const { scoring, rows } of boards)
	await writeFile(
		new URL(`boards/${scoring.id}.json`, OUT),
		JSON.stringify({ ...ppr, format: scoring.id, rows })
	);

// Each kept player's page carries his row in every scoring.
for (const file of await readdir(new URL('players/', OUT))) {
	const url = new URL(`players/${file}`, OUT);
	const page = await readJson(url);
	const formats = page.formats as Record<string, Json>;
	const numbers = formats[SOURCE];
	if (numbers === undefined) continue;
	for (const { scoring, rows } of boards) {
		const row = rows.find((candidate) => candidate.id === page.id);
		if (row === undefined) continue;
		formats[scoring.id] = {
			...numbers,
			...Object.fromEntries(PAGE_FIELDS.map((field) => [field, row[field]]))
		};
	}
	await writeFile(url, JSON.stringify(page));
}

const manifestUrl = new URL('manifest.json', OUT);
const manifest = await readJson(manifestUrl);
const lead = (manifest.formats as Json[])[0] ?? {};
const leadBasis = (lead.basis as string[] | undefined) ?? [];
manifest.runId = FORMATS_RUN_ID;
manifest.formats = [
	lead,
	...SCORINGS.map((scoring) => ({
		...lead,
		id: scoring.id,
		label: scoring.label,
		unit: `${scoring.label} pts`,
		basis: leadBasis.map((part) => part.replace(/^PPR\b/u, scoring.basisWord))
	}))
];
await writeFile(manifestUrl, JSON.stringify(manifest));
process.stdout.write(
	`${FORMATS_RUN_ID}: ${String(SCORINGS.length + 1)} scorings, ${OUT.pathname}\n`
);
