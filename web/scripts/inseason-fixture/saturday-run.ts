// The Saturday before week 6's Sunday as a run (Lane 86): the contract run (2026-10-21T12-ros, made
// after week 6, from week 7) moved back to the fixture's week clock, so the shots on the Sunday, Monday
// and Tuesday clocks show the rest of season between a run and the next. Written to
// web/.runs/runs/2026-10-17T17-ros (never committed); the stand-in's latest.json is left as it is.
// STAND-INS, named here and in the report: the run's three backs (Gibbs, Lloyd, Jacobs) share one
// tier in every format, so a tier box lists several players (re-review N5); each in-season row's points are the contract run's over
// his club's games from week 6 still to play at the Saturday instant, its points a game times them
// (the API's own rule between runs, restlive.go), its expected games the same way, and its points
// over replacement moved by the same amount (the replacement level kept); the week each row starts
// from is his club's first game not yet kicked off (Thursday's clubs start at week 7); a game is final
// at the Saturday instant once its kickoff has passed. Everything else is the contract run's.
//
//   [SATURDAY_OUT=4429023] [SATURDAY_PACE=1] [SATURDAY_READ=1] node scripts/inseason-fixture/saturday-run.ts
// then build with PUBLIC_RUN_ID=2026-10-17T17-ros PUBLIC_RUN_BASE_URL=.runs and start the fixture API
// with FIXTURE_RUN_ID=2026-10-17T17-ros.
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { restFromWords } from '../../src/lib/run/rest-from.ts';
import { FIXTURE_WEEK_CLOCK } from './clock.ts';
import { CONTRACT_RUN_ID as SOURCE_ID, SATURDAY_RUN_ID } from './run-ids.ts';

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

/** The backs' one tier: tier 1, no drop (the last tier at the position). */
function sharedTier(numbers: Json, position: unknown): Json {
	return position === 'RB' && typeof numbers.tier === 'number'
		? { ...numbers, tier: 1, tierDrop: null }
		: numbers;
}

/** SATURDAY_PACE=1 (Lane 117, B80): a STAND-IN preseason pace a game on every in-season page, his
 * preseason points over the 17 games, so the vs Avg tile draws its reason as a run that stores the
 * pace does (Lane 100's preseasonPerGame), with a STAND-IN share the pace carries (Lane 139's
 * preseasonShare, a running back's PPR k of 2 over 5 games) and the steps; the contract run predates the fields. */
const PACE_GAMES = 17;
const PACE_SHARE = 29;
/** STAND-IN for the blend (Lane 139 fix round 1), Gibbs-sized; the rate a game played is set from it, the
 * pace and the share by the model's own step (Lane 139 fix round 2, LOW-10), so the shot's figures close. */
const PACE_BLEND = 27.1;
const PERCENT = 100;
function paceRate(paceAGame: number): number {
	const share = PACE_SHARE / PERCENT;
	return tenth(share * paceAGame + (1 - share) * PACE_BLEND);
}
const pace = process.env.SATURDAY_PACE === '1';
function withPace(numbers: Json): Json {
	const points = numbers.preseasonPoints;
	return pace && typeof points === 'number'
		? {
				...numbers,
				preseasonPerGame: tenth(points / PACE_GAMES),
				preseasonShare: PACE_SHARE,
				blendedPerGame: PACE_BLEND,
				ratePerGame: paceRate(tenth(points / PACE_GAMES))
			}
		: numbers;
}

/** SATURDAY_READ=1 (Lane 117, B95 fix round 3): a STAND-IN week read for Gibbs at the cap of the 40 to 95
 * band, hand written for the shots (never a recording), so the player page shows the box a full read grows
 * to. Its body and call are research's (Lane 121, B98), where a test runs the writer's validator on them
 * against Gibbs's recorded sheet, so the shot draws a read the nightly would publish. */
const longRead = process.env.SATURDAY_READ === '1';
const LONG_READ_FILE = new URL(
	'../../../research/tests/testdata/week_reads/long_bye_read.json',
	import.meta.url
);
const standIn = JSON.parse(await readFile(LONG_READ_FILE, 'utf8')) as {
	id: string;
	body: string;
	call: string;
};
const LONG_READ = {
	week: FIRST_WEEK,
	body: standIn.body,
	caption: 'Written Sat Oct 17, 11:12 am CT, for week 6',
	status: null,
	call: standIn.call,
	writtenAt: '2026-10-17T16:12:00.000Z',
	factsAt: '2026-10-17T16:00:00.000Z'
};

const index = (await read('index.json')) as unknown as { id: string; team: string }[];
const teamOf = new Map(index.map((p) => [p.id, p.team]));
for (const file of await readdir(new URL('boards/', OUT))) {
	const board = await read(`boards/${file}`);
	board.rows = (board.rows as Json[]).map((row) =>
		sharedTier(moved(row, String(row.team)), row.position)
	);
	await write(`boards/${file}`, board);
}
for (const file of await readdir(new URL('players/', OUT))) {
	const page = await read(`players/${file}`);
	const team = teamOf.get(String(page.id)) ?? String(page.team);
	page.formats = Object.fromEntries(
		Object.entries(page.formats as Record<string, Json>).map(([id, n]) => [
			id,
			withPace(sharedTier(moved(n, team), page.position))
		])
	);
	if (longRead && page.id === standIn.id) page.weekRead = LONG_READ;
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
// SATURDAY_OUT=<board id> (Lane 117, B80): a STAND-IN injury capture listing that player Out for
// week 6, read Friday afternoon, so the player page shots hold an Out player beside a playing one
// and one on his bye. The contract run carries no capture of its own.
const out = process.env.SATURDAY_OUT;
if (out !== undefined && out !== '') {
	const readAt = '2026-10-16T21:00:00.000Z';
	await write('designations.json', {
		readAt,
		checkedAt: readAt,
		source: 'stand-in',
		players: { [out]: { status: 'out', seasonLong: false, since: null } }
	});
}
process.stdout.write(`${SATURDAY_RUN_ID}: written to ${OUT.pathname}\n`);
