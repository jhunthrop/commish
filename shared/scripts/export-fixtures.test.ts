// The fixtures the apps test on (shared/fixtures, written by export-fixtures.ts): their names, and the
// committed files themselves. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { claimBody, clockPart, fixturePlan } from './export-fixtures.ts';
import { REPOSITORY } from './generated.ts';

const FIXTURES = join(REPOSITORY, 'shared/fixtures');
const LEAGUE = '6f1d1c52-2626-4a26-9a26-000000000026';
const CLOCKS = {
	week: '2026-10-17T17:00:00.000Z',
	thursdayNight: '2026-10-16T02:00:00.000Z',
	sunday: '2026-10-18T18:56:00.000Z',
	monday: '2026-10-19T16:00:00.000Z',
	live: '2026-10-20T00:40:00.000Z',
	tuesday: '2026-10-20T17:00:00.000Z'
};

interface Envelope {
	ok: boolean;
	data: Record<string, unknown> | unknown[] | null;
	error: unknown;
}

const answer = (file: string): Envelope =>
	JSON.parse(readFileSync(join(FIXTURES, 'inseason', file), 'utf8')) as Envelope;

void test('an instant names a file with no colons', () => {
	assert.equal(clockPart('2026-10-17T17:00:00.000Z'), '2026-10-17T17-00-00Z');
	assert.throws(() => clockPart('Saturday'), /Saturday/);
});

void test('the plan reads the league once, its scoreboard, lineup, matchup and league read at every clock', () => {
	const files = fixturePlan({ leagueId: LEAGUE, clocks: CLOCKS }).flatMap((step) => step.files);
	const names = files.map((f) => f.file);
	assert.ok(names.includes(`leagues-attached-${LEAGUE}.json`));
	assert.ok(names.includes('leagues-attached.json'));
	for (const clock of Object.values(CLOCKS)) {
		assert.ok(names.includes(`scoreboard-${LEAGUE}-${clockPart(clock)}.json`), clock);
		assert.ok(names.includes(`lineup-${LEAGUE}-${clockPart(clock)}.json`), clock);
		assert.ok(names.includes(`matchup-${LEAGUE}-${clockPart(clock)}.json`), clock);
		assert.ok(names.includes(`sync-${LEAGUE}-${clockPart(clock)}.json`), clock);
		assert.ok(names.includes(`waivers-${LEAGUE}-${clockPart(clock)}.json`), clock);
	}
	assert.equal(new Set(names).size, names.length, 'every file once');
});

void test('every committed fixture parses, and every answer is a successful envelope', () => {
	assert.ok(JSON.parse(readFileSync(join(FIXTURES, 'mock-2026-ppr.json'), 'utf8')));
	const files = readdirSync(join(FIXTURES, 'inseason'));
	assert.ok(files.length >= 15, files.join(', '));
	for (const file of files) {
		const body = answer(file);
		assert.equal(body.ok, true, file);
		assert.notEqual(body.data, null, file);
	}
});

void test('the league file carries the league: its id, its platform and its teams', () => {
	const league = answer(`leagues-attached-${LEAGUE}.json`).data as Record<string, unknown>;
	assert.equal(league.id, LEAGUE);
	assert.equal(league.host, 'ffpc');
	assert.ok(Array.isArray(league.teams) && league.teams.length > 0);
});

void test('each scoreboard is read at its own clock, the README names every file', () => {
	const readme = readFileSync(join(FIXTURES, 'README.md'), 'utf8');
	for (const clock of Object.values(CLOCKS)) {
		const file = `scoreboard-${LEAGUE}-${clockPart(clock)}.json`;
		assert.ok(answer(file).data, file);
		assert.ok(readme.includes(file), file);
	}
});

const ESPN = {
	done: '6f1d1c52-2626-4a26-9a26-000000000035',
	refused: '6f1d1c52-2626-4a26-9a26-000000000036',
	pending: '6f1d1c52-2626-4a26-9a26-000000000037'
};

void test("each ESPN stand-in's Waivers, its claim planned then made, at the week's clock (Lane 186)", () => {
	const plan = fixturePlan({ leagueId: LEAGUE, espn: ESPN, clocks: CLOCKS });
	const week = plan.find((step) => step.clock === CLOCKS.week)?.files ?? [];
	for (const id of Object.values(ESPN)) {
		const pool = `waivers-${id}-${clockPart(CLOCKS.week)}.json`;
		const planned = week.find((f) => f.file === `claim-plan-${id}.json`);
		const made = week.find((f) => f.file === `claim-move-${id}.json`);
		assert.ok(
			week.some((f) => f.file === pool),
			pool
		);
		assert.deepEqual(planned?.claim, { waivers: pool, plan: null });
		assert.equal(planned.route, `POST /leagues/attached/${id}/moves/plan`);
		assert.deepEqual(made?.claim, { waivers: pool, plan: `claim-plan-${id}.json` });
	}
	// The claims come after the answers their bodies are built from.
	const order = week.map((f) => f.file);
	assert.ok(
		order.indexOf(`claim-plan-${ESPN.done}.json`) >
			order.indexOf(`waivers-${ESPN.done}-${clockPart(CLOCKS.week)}.json`)
	);
});

void test("a claim's body: the first pickup with no bid planned, the plan's bid and token made", () => {
	const pool = answer(`waivers-${ESPN.pending}-${clockPart(CLOCKS.week)}.json`);
	const planned = answer(`claim-plan-${ESPN.pending}.json`);
	const answers = new Map<string, unknown>([
		['w.json', pool],
		['p.json', planned]
	]);
	const first = (pool.data as { pickups: { add: { player: { host_id: string } } }[] }).pickups[0];
	const body = claimBody(
		{ file: 'p.json', route: '', clock: null, about: '', claim: { waivers: 'w.json', plan: null } },
		answers
	) as { kind: string; claim: { add: string; bid: number | null } };
	assert.equal(body.kind, 'claim');
	assert.equal(body.claim.add, first?.add.player.host_id);
	assert.equal(body.claim.bid, null);
	const made = claimBody(
		{
			file: 'm.json',
			route: '',
			clock: null,
			about: '',
			claim: { waivers: 'w.json', plan: 'p.json' }
		},
		answers
	) as { confirm: string; move: { claim: { bid: number | null } } };
	assert.equal(made.confirm, 'fixture-token');
	assert.equal(made.move.claim.bid, 0);
	const result = answer(`claim-move-${ESPN.pending}.json`).data as { outcome: string };
	assert.equal(result.outcome, 'pending');
});
