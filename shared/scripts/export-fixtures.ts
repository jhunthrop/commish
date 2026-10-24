/** The web's fixtures as JSON under shared/fixtures, for the apps' view-model and snapshot tests: the
 * mock's 2026 PPR data (web/src/fixtures/mock-2026-ppr.ts) and the in-season fixture league as the
 * FFPC league (web/scripts/inseason-fixture, the `fixture_platform=ffpc` stand-in), each answer the
 * API would give at the fixture's clocks, envelope and all, named by its route. README.md, written
 * beside them, lists each file with its route and its clock.
 *
 *   node shared/scripts/export-fixtures.ts
 *
 * The answers come from the fixture API itself (serve.ts), started once per clock on a free port with
 * its clock stopped there (frozen-clock.ts), so the export is the same on every run. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { REPOSITORY, generatedBy, writeOutputs, type Outputs } from './generated.ts';

const SCRIPT = 'shared/scripts/export-fixtures.ts';
const FIXTURES = 'shared/fixtures';
const MOCK_MODULE = 'web/src/fixtures/mock-2026-ppr.ts';
const SERVE = 'web/scripts/inseason-fixture/serve.ts';
const FROZEN_CLOCK = join(REPOSITORY, 'shared/scripts/frozen-clock.ts');
/** The cookie the fixture API reads the FFPC stand-in of the recorded league by. */
const FFPC_COOKIE = 'fixture_platform=ffpc';
const START_TIMEOUT_MS = 30_000;
const POLL_MS = 100;

/** The fixture clocks a scoreboard is exported at, by name, from the fixture's own clock module. */
export interface FixtureClocks {
	week: string;
	thursdayNight: string;
	sunday: string;
	monday: string;
	live: string;
	tuesday: string;
}

/** The fixture's league id and its clocks (web/scripts/inseason-fixture/ids.ts and clock.ts). */
interface FixtureSource {
	leagueId: string;
	clocks: FixtureClocks;
}

/** An answer's file: the route it answers, the clock it was read at, and what the file holds. */
export interface FixtureFile {
	file: string;
	route: string;
	clock: string | null;
	about: string;
}

/** An instant as a file name part, with no colons: `2026-10-17T17:00:00.000Z` as `2026-10-17T17-00-00Z`. */
export function clockPart(iso: string): string {
	const at = new Date(Date.parse(iso));
	if (Number.isNaN(at.getTime())) throw new Error(`"${iso}" is not an instant.`);
	return at
		.toISOString()
		.replace(/\.\d{3}Z$/, 'Z')
		.replace(/:/g, '-');
}

/** The answers to read at each clock, the League home's reads: the league list and the league once,
 * at the week's clock, with the week's games, and the scoreboard and the member's lineup at every
 * clock (the lineup's lines carry each player's game, which the game-state parity reads, Lane 176). */
export function fixturePlan(source: FixtureSource): { clock: string; files: FixtureFile[] }[] {
	const id = source.leagueId;
	const { week, ...rest } = source.clocks;
	const scoreboard = (clock: string, name: string): FixtureFile => ({
		file: `scoreboard-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/scoreboard`,
		clock,
		about: `the week's scoreboard, ${name}`
	});
	const lineup = (clock: string, name: string): FixtureFile => ({
		file: `lineup-${id}-${clockPart(clock)}.json`,
		route: `GET /leagues/attached/${id}/lineup`,
		clock,
		about: `the member's lineup, ${name}`
	});
	const atClock = (clock: string, name: string): FixtureFile[] => [
		scoreboard(clock, name),
		lineup(clock, name)
	];
	return [
		{
			clock: week,
			files: [
				{
					file: 'leagues-attached.json',
					route: 'GET /leagues/attached',
					clock: week,
					about: "the account's leagues, the FFPC league among the fixture's stand-ins"
				},
				{
					file: `leagues-attached-${id}.json`,
					route: `GET /leagues/attached/${id}/sync`,
					clock: week,
					about: "the FFPC league: teams, standings, moves, terms, the member's matchup"
				},
				{
					file: 'games-week.json',
					route: 'GET /games/week',
					clock: week,
					about: "the week's NFL games with their facts, as the platform games are drawn from"
				},
				...atClock(week, 'Saturday noon Central, every Sunday game to come')
			]
		},
		...Object.entries(rest).map(([name, clock]) => ({
			clock,
			files: atClock(clock, CLOCK_WORDS[name as keyof typeof rest])
		}))
	];
}

const CLOCK_WORDS: Readonly<Record<Exclude<keyof FixtureClocks, 'week'>, string>> = {
	thursdayNight: 'Thursday night, the Thursday game under way',
	sunday: 'Sunday afternoon, the noon games in their fourth quarter',
	monday: 'Monday morning, every Sunday game final',
	live: 'Monday night, the Monday game in its first quarter',
	tuesday: 'Tuesday noon, every game of the week final'
};

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			server.close(() => resolve(port));
		});
	});
}

async function waitFor(origin: string, child: ChildProcess): Promise<void> {
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`${SERVE} exited with ${String(child.exitCode)}.`);
		try {
			if ((await fetch(`${origin}/fixture/clock`)).ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	throw new Error(`${SERVE} did not answer within ${String(START_TIMEOUT_MS)} ms.`);
}

/** Starts the fixture API on `clock`, stopped there, reads each file's route and stops it. */
async function readAt(clock: string, files: readonly FixtureFile[]): Promise<[string, string][]> {
	const port = await freePort();
	const origin = `http://127.0.0.1:${String(port)}`;
	// A clean environment: no FIXTURE_* flag of the caller's changes what the API answers.
	const child = spawn(process.execPath, ['--import', FROZEN_CLOCK, join(REPOSITORY, SERVE)], {
		env: {
			PATH: process.env.PATH ?? '',
			PORT: String(port),
			FIXTURE_CLOCK: clock,
			FROZEN_CLOCK: clock
		},
		stdio: ['ignore', 'ignore', 'inherit']
	});
	try {
		await waitFor(origin, child);
		return await Promise.all(
			files.map(async (file): Promise<[string, string]> => {
				const path = file.route.replace(/^GET /, '');
				const response = await fetch(`${origin}${path}`, { headers: { cookie: FFPC_COOKIE } });
				if (!response.ok)
					throw new Error(`${file.route} at ${clock} answered ${String(response.status)}.`);
				const body: unknown = await response.json();
				return [`${FIXTURES}/inseason/${file.file}`, `${JSON.stringify(body, null, '\t')}\n`];
			})
		);
	} finally {
		child.kill();
	}
}

/** The mock's data: every export of the module, by its name. */
async function mockFixture(): Promise<string> {
	const module = (await import(join(REPOSITORY, MOCK_MODULE))) as Record<string, unknown>;
	for (const [name, value] of Object.entries(module)) {
		if (typeof value === 'function') throw new Error(`${MOCK_MODULE} exports ${name}, a function.`);
	}
	const sorted = Object.fromEntries(Object.entries(module).sort(([a], [b]) => a.localeCompare(b)));
	return `${JSON.stringify(sorted, null, '\t')}\n`;
}

function readme(plan: ReturnType<typeof fixturePlan>, source: FixtureSource): string {
	const rows = plan
		.flatMap((step) => step.files)
		.map((f) => `| \`inseason/${f.file}\` | \`${f.route}\` | ${f.clock ?? ''} | ${f.about} |`);
	const clocks = Object.entries(source.clocks).map(
		([name, clock]) => `- \`${name}\`: ${clock} (${clockPart(clock)} in a file name)`
	);
	return `# Shared fixtures

${generatedBy(SCRIPT, `${MOCK_MODULE} and ${SERVE}`)}

The apps' view-model and snapshot tests read these, so the iOS app, the Android app and the web are
tested on the same data. Each in-season file is one answer of the fixture API (the stand-in of the
request API the web's shots run against) exactly as it sends it, the envelope (\`ok\`, \`data\`,
\`error\`) included, read with its clock stopped at the instant named. The league is the recorded
Sleeper league as the FFPC stand-in reads it (cookie \`${FFPC_COOKIE}\`), id \`${source.leagueId}\`.
A test that draws a screen at a clock passes the same instant as its injected clock.

| File | Route | Clock | What it holds |
| --- | --- | --- | --- |
| \`mock-2026-ppr.json\` | none | none | the mock's 2026 PPR data, every export of \`${MOCK_MODULE}\` by name |
${rows.join('\n')}

## The fixture clocks

${clocks.join('\n')}
`;
}

async function fixtureSource(): Promise<FixtureSource> {
	const ids = (await import(join(REPOSITORY, 'web/scripts/inseason-fixture/ids.ts'))) as {
		FIXTURE_IDS: { league: string };
	};
	const c = (await import(join(REPOSITORY, 'web/scripts/inseason-fixture/clock.ts'))) as Record<
		string,
		string
	>;
	const clock = (name: string): string => {
		const value = c[name];
		if (typeof value !== 'string') throw new Error(`clock.ts exports no ${name}.`);
		return value;
	};
	return {
		leagueId: ids.FIXTURE_IDS.league,
		clocks: {
			week: clock('FIXTURE_WEEK_CLOCK'),
			thursdayNight: clock('FIXTURE_THURSDAY_NIGHT_CLOCK'),
			sunday: clock('FIXTURE_SUNDAY_CLOCK'),
			monday: clock('FIXTURE_MONDAY_CLOCK'),
			live: clock('FIXTURE_LIVE_CLOCK'),
			tuesday: clock('FIXTURE_TUESDAY_CLOCK')
		}
	};
}

export async function generate(): Promise<Outputs> {
	const source = await fixtureSource();
	const plan = fixturePlan(source);
	const answers: [string, string][] = [];
	// One clock at a time: each starts its own fixture API.
	for (const step of plan) answers.push(...(await readAt(step.clock, step.files)));
	return new Map([
		[`${FIXTURES}/mock-2026-ppr.json`, await mockFixture()],
		...answers,
		[`${FIXTURES}/README.md`, readme(plan, source)]
	]);
}

if (import.meta.main) await writeOutputs(await generate());
