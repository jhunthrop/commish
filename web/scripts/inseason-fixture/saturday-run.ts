// The Saturday before week 6's Sunday as a run (Lane 86): the contract run (2026-10-21T12-ros, made
// after week 6, from week 7) moved back to the fixture's week clock, so the shots on the Sunday, Monday
// and Tuesday clocks show the rest of season between a run and the next. Written to
// web/.runs/runs/2026-10-17T17-ros (never committed); the stand-in's latest.json is left as it is.
// STAND-INS, named here and in the report: each in-season row's points are the contract run's over
// his club's games from week 6 still to play at the Saturday instant, its points a game times them
// (the API's own rule between runs, restlive.go), its expected games the same way, and its points
// over replacement moved by the same amount (the replacement level kept); the week each row starts
// from is his club's first game not yet kicked off (Thursday's clubs start at week 7); a game is final
// at the Saturday instant once its kickoff has passed. Everything else is the contract run's.
//
//   node scripts/inseason-fixture/saturday-run.ts
// then build with PUBLIC_RUN_ID=2026-10-17T17-ros PUBLIC_RUN_BASE_URL=.runs and start the fixture API
// with FIXTURE_RUN_ID=2026-10-17T17-ros.
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { restFromWords } from '../../src/lib/run/rest-from.ts';
import { FIXTURE_WEEK_CLOCK } from './clock.ts';

const SOURCE_ID = '2026-10-21T12-ros';
export const SATURDAY_RUN_ID = '2026-10-17T17-ros';
const SOURCE = new URL(
	`../../../research/nightly/contract/fixture/runs/${SOURCE_ID}/`,
	import.meta.url
);
const OUT = new URL(`../../.runs/runs/${SATURDAY_RUN_ID}/`, import.meta.url);
const SATURDAY = Date.parse(FIXTURE_WEEK_CLOCK);
const FIRST_WEEK = 6;
const LAST_WEEK = 17;
const TENTH = 10;

type Json = Record<string, unknown>;
interface Game {
	week: number;
	kickoff: string | null;
	state: string;
}
interface Slate {
	abbr: string;
	games: Game[];
}

const tenth = (v: number): number => Math.round(v * TENTH) / TENTH;
const read = async (path: string): Promise<Json> =>
	JSON.parse(await readFile(new URL(path, OUT), 'utf8')) as Json;
const write = (path: string, value: unknown): Promise<void> =>
	writeFile(new URL(path, OUT), JSON.stringify(value));

await cp(SOURCE, OUT, { recursive: true });
const schedule = await read('schedule.json');
const slates = schedule.slates as Slate[];
const toPlay = (slate: Slate, from: number, at: number): number[] =>
	slate.games
		.filter(
			(g) =>
				g.week >= from && g.week <= LAST_WEEK && g.kickoff !== null && Date.parse(g.kickoff) > at
		)
		.map((g) => g.week);
const club = new Map(
	slates.map((s) => {
		const saturday = toPlay(s, FIRST_WEEK, SATURDAY);
		return [s.abbr, { saturday, run: toPlay(s, FIRST_WEEK + 1, -Infinity) }] as const;
	})
);
// The Saturday's states: a game is final once its kickoff has passed.
schedule.slates = slates.map((s) => ({
	...s,
	games: s.games.map((g) => ({
		...g,
		state: g.kickoff !== null && Date.parse(g.kickoff) <= SATURDAY ? 'final' : 'upcoming'
	}))
}));
await write('schedule.json', schedule);

/** One in-season row's numbers at the Saturday: over his club's games from week 6 still to play. */
function moved(numbers: Json, team: string): Json {
	if (!('preseasonRank' in numbers) || typeof numbers.projected !== 'number') return numbers;
	const games = club.get(team);
	if (games === undefined || games.run.length === 0) return numbers;
	const scale = games.saturday.length / games.run.length;
	const projected = tenth(numbers.projected * scale);
	return {
		...numbers,
		projected,
		expectedGames: tenth((numbers.expectedGames as number) * scale),
		vor: tenth((numbers.vor as number) + projected - numbers.projected),
		restFromWeek: games.saturday[0] ?? null
	};
}

const index = (await read('index.json')) as unknown as { id: string; team: string }[];
const teamOf = new Map(index.map((p) => [p.id, p.team]));
for (const file of await readdir(new URL('boards/', OUT))) {
	const board = await read(`boards/${file}`);
	board.rows = (board.rows as Json[]).map((row) => moved(row, String(row.team)));
	await write(`boards/${file}`, board);
}
for (const file of await readdir(new URL('players/', OUT))) {
	const page = await read(`players/${file}`);
	const team = teamOf.get(String(page.id)) ?? String(page.team);
	page.formats = Object.fromEntries(
		Object.entries(page.formats as Record<string, Json>).map(([id, n]) => [id, moved(n, team)])
	);
	await write(`players/${file}`, page);
}
const manifest = await read('manifest.json');
const at = new Date(SATURDAY).toISOString();
manifest.runId = SATURDAY_RUN_ID;
manifest.runAt = at;
manifest.formats = (manifest.formats as Json[]).map((f) => ({
	...f,
	basis: (f.basis as string[]).map((line) =>
		line.replace(
			/from week \d+, refreshed October \d+/,
			`${restFromWords(FIRST_WEEK, true)}, refreshed October 17`
		)
	),
	rosFromWeek: FIRST_WEEK,
	rosFromWeekPartial: true,
	refreshedAt: at
}));
await write('manifest.json', manifest);
process.stdout.write(`${SATURDAY_RUN_ID}: written to ${OUT.pathname}\n`);
