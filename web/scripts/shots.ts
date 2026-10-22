// Every fixture shot script in one command (Lane 132, B111): `npm run shots`. It writes each run the
// scripts are built from, builds the site once per run against its own fixture API, serves the build
// with the Worker, starts the fixture API on each case's clock and flags, runs the case and stops what
// it started, by its own process group. It prints one line per case and a table at the end, and exits
// non-zero when any case does.
//
// The runs, each written by the repo's own writer:
//   standin       `npm run standin` (the one prepared run, Lane 128: the recorded injury capture, no
//                 dev read at shot time; the writer itself reads dev for ADP, the slate and the record)
//   contract      the nightly's contract fixture run (research/nightly/contract/fixture), copied as is
//   saturday      inseason-fixture/saturday-run.ts with its three stand-ins (an Out player, the pace, the
//                 long read), the contract run moved to the fixture week's Saturday
//   mover, free-agent   inseason-fixture/mover-run.ts, the contract run with Jahmyr Gibbs as a club
//                 mover or a free agent
//   oneboard      inseason-fixture/one-board-run.ts
//   record-live   record-fixture/run.ts live
//   two-upcoming, two-graded   record-fixture/run.ts two <mode>
// The dev server (`vite dev`) answers the dev-only system page for the two scripts that shoot it.
//
// The scripts on the real API (companion, context, ffpc, league, multi-league, pass, plan-card, room,
// ux-fix-6) and the ones on a plain build (offline, weight) read no fixture and are not run here.
//
//   npm run shots [-- <case name or script name>...]   every case, or only those named
// Ports: SHOTS_PORT_BASE (default 8840) and the next three: the fixture API, the Worker, its inspector
// and the dev server. Logs and shots go to screenshots/shots/<case>/.
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { SHOT_CASES, SHOT_RUNS, type RunKey, type ShotCase } from './shots-cases.ts';

const BASE = Number(process.env.SHOTS_PORT_BASE ?? 8840);
const PORTS = { fixture: BASE, web: BASE + 1, inspector: BASE + 2, dev: BASE + 3 } as const;
const ORIGIN = {
	fixture: `http://localhost:${String(PORTS.fixture)}`,
	web: `http://localhost:${String(PORTS.web)}`,
	dev: `http://localhost:${String(PORTS.dev)}`
} as const;
const WEB = new URL('../', import.meta.url).pathname;
const OUT = new URL('../screenshots/shots/', import.meta.url).pathname;
const BIN = `${WEB}node_modules/.bin/`;
const START_MS = 120_000;
const POLL_MS = 500;
/** A case may take this long before it is stopped and counted as failed. */
const CASE_MS = 15 * 60_000;
/** The code a case gets when its run does not build. */
const BUILD_FAILED = 2;

const named = process.argv.slice(2);
const cases = SHOT_CASES.filter(
	(c) => named.length === 0 || named.includes(c.name) || named.includes(c.script)
);
if (cases.length === 0) throw new Error(`No shot case is named ${named.join(', ')}.`);

const owned = new Set<ChildProcess>();

/** Starts a command in its own process group, so stopping it stops what it started. */
function start(command: string, args: readonly string[], env: NodeJS.ProcessEnv, log?: string) {
	const child = spawn(command, args, {
		cwd: WEB,
		env: { ...process.env, ...env },
		detached: true,
		stdio: log === undefined ? 'ignore' : ['ignore', 'pipe', 'pipe']
	});
	owned.add(child);
	return child;
}

function stop(child: ChildProcess): void {
	if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			// Already gone.
		}
	}
	owned.delete(child);
}

function stopAll(): void {
	for (const child of owned) stop(child);
}
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

/** Runs a command to its end, its output kept in `log` (or passed through), and gives its exit code. */
async function run(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv = {},
	log?: string
): Promise<number> {
	const child = start(command, args, env, log);
	const chunks: Buffer[] = [];
	child.stdout?.on('data', (b: Buffer) => chunks.push(b));
	child.stderr?.on('data', (b: Buffer) => chunks.push(b));
	const timer = setTimeout(() => stop(child), CASE_MS);
	const code = await new Promise<number>((resolve) => {
		child.on('close', (c) => resolve(c ?? 1));
	});
	clearTimeout(timer);
	owned.delete(child);
	if (log !== undefined) await writeFile(log, Buffer.concat(chunks));
	return code;
}

async function must(command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
	const code = await new Promise<number>((resolve) => {
		const child = spawn(command, args, {
			cwd: WEB,
			env: { ...process.env, ...env },
			stdio: 'inherit'
		});
		child.on('close', (c) => resolve(c ?? 1));
	});
	if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${String(code)}.`);
}

async function answers(url: string): Promise<boolean> {
	return fetch(url)
		.then((r) => r.status < 500)
		.catch(() => false);
}

async function waitFor(url: string, what: string): Promise<void> {
	const until = Date.now() + START_MS;
	while (Date.now() < until) {
		if (await answers(url)) return;
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
	throw new Error(`${what} did not answer at ${url}.`);
}

/** Writes each run the cases are built from, once. */
async function writeRuns(keys: ReadonlySet<RunKey>): Promise<void> {
	for (const key of keys) {
		const runSpec = SHOT_RUNS[key];
		if (runSpec.copyFrom !== undefined) {
			const to = `${WEB}.runs/runs/${runSpec.id}/`;
			await rm(to, { recursive: true, force: true });
			await cp(new URL(runSpec.copyFrom, import.meta.url).pathname, to, { recursive: true });
		}
		for (const step of runSpec.write ?? []) await must(process.execPath, step.args, step.env ?? {});
	}
}

async function build(key: RunKey): Promise<void> {
	await must('npm', ['run', 'build'], {
		PUBLIC_RUN_ID: SHOT_RUNS[key].id,
		PUBLIC_RUN_BASE_URL: '.runs',
		PUBLIC_API_URL: ORIGIN.fixture
	});
}

function serveWorker(): ChildProcess {
	return start(
		`${BIN}wrangler`,
		[
			'dev',
			'.svelte-kit/cloudflare/_worker.js',
			'--port',
			String(PORTS.web),
			'--inspector-port',
			String(PORTS.inspector)
		],
		{}
	);
}

function serveDev(): ChildProcess {
	return start(`${BIN}vite`, ['dev', '--port', String(PORTS.dev), '--strictPort'], {
		PUBLIC_API_URL: ORIGIN.fixture
	});
}

function startFixture(c: ShotCase): ChildProcess {
	return start(process.execPath, ['scripts/inseason-fixture/serve.ts'], {
		PORT: String(PORTS.fixture),
		FIXTURE_CLOCK: c.clock,
		...(SHOT_RUNS[c.run].fixtureRun ? { FIXTURE_RUN_ID: SHOT_RUNS[c.run].id } : {}),
		...c.fixture
	});
}

async function runCase(c: ShotCase, dev: string | null): Promise<number> {
	const out = `${OUT}${c.name}/`;
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	const fixture = c.ownFixture ? null : startFixture(c);
	try {
		if (fixture !== null) await waitFor(`${ORIGIN.fixture}/fixture/clock`, 'The fixture API');
		const args = c.args({ web: ORIGIN.web, api: ORIGIN.fixture, apiPort: PORTS.fixture, out });
		const env = {
			API_ORIGIN: ORIGIN.fixture,
			...(dev === null ? {} : { DEV_ORIGIN: dev, SYSTEM_ORIGIN: dev }),
			...(SHOT_RUNS[c.run].scriptRun
				? { PUBLIC_RUN_ID: SHOT_RUNS[c.run].id, PUBLIC_RUN_BASE_URL: '.runs' }
				: {}),
			...c.env
		};
		return await run(process.execPath, [`scripts/${c.script}.ts`, ...args], env, `${out}log.txt`);
	} finally {
		if (fixture !== null) stop(fixture);
	}
}

const results: { name: string; code: number }[] = [];
const runs = [...new Set(cases.map((c) => c.run))];
await writeRuns(new Set(runs));
const dev = cases.some((c) => c.dev) ? serveDev() : null;
try {
	if (dev !== null) await waitFor(ORIGIN.dev, 'The dev server');
	for (const key of runs) {
		const runCases = cases.filter((x) => x.run === key);
		try {
			await build(key);
		} catch (error: unknown) {
			// A run that does not build fails every case on it; the sweep goes on to the next run.
			process.stderr.write(`The ${key} run did not build: ${String(error)}\n`);
			for (const c of runCases) results.push({ name: c.name, code: BUILD_FAILED });
			continue;
		}
		const worker = serveWorker();
		try {
			await waitFor(ORIGIN.web, 'The Worker');
			for (const c of runCases) {
				const code = await runCase(c, c.dev ? ORIGIN.dev : null);
				results.push({ name: c.name, code });
				process.stdout.write(`${code === 0 ? 'pass' : 'FAIL'} ${c.name} (${String(code)})\n`);
			}
		} finally {
			stop(worker);
		}
	}
} finally {
	if (dev !== null) stop(dev);
}

const failed = results.filter((r) => r.code !== 0);
process.stdout.write(
	`\n${results.map((r) => `${String(r.code).padStart(3)}  ${r.name}`).join('\n')}\n\n` +
		`${String(results.length - failed.length)} of ${String(results.length)} cases pass. Logs in ${OUT}\n`
);
process.exitCode = failed.length === 0 ? 0 : 1;
