// Every face is our own copy (Lane 241): asked of our images host at the kept width for its drawn
// size, 1x and 2x; a provider address saved before the copies is read as the copy of the same id;
// any other image off our origin is no face, so a page never asks a third party for one. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	HEADSHOT_WIDTHS,
	headshotAt,
	headshotFor,
	headshotSources,
	isHeadshotLeague,
	keptWidth
} from './headshot.ts';
import { upstreamHeadshotUrl } from './headshot-provider.ts';

// Research (test_headshots.py) and the API (headshots_test.go) pin this same URL.
const OURS = 'https://images.trycommish.app/headshots/2026/4429795/320.webp';
const NFL = 'https://a.espncdn.com/i/headshots/nfl/players/full/4429795.png';
const COLLEGE = 'https://a.espncdn.com/i/headshots/college-football/players/full/4708490.png';
const copy = (id: string, width: number, season = 2026): string =>
	`https://images.trycommish.app/headshots/${String(season)}/${id}/${String(width)}.webp`;

void test('a face asks our host for the kept width at or above its drawn width, 1x and 2x', () => {
	// 40 px drawn 1.4 times: 56 at 1x, 112 at 2x.
	assert.deepEqual(headshotSources(OURS, 40), {
		src: copy('4429795', 64),
		srcset: `${copy('4429795', 64)} 1x, ${copy('4429795', 128)} 2x`
	});
	assert.equal(headshotFor('4429795'), OURS);
});

void test("the season is the copy's own", () => {
	const older = copy('4429795', 320, 2027);
	assert.equal(headshotSources(older, 22)?.src, copy('4429795', 48, 2027));
});

void test('a face smaller on the phone lists the kept widths with the sizes that pick them', () => {
	assert.deepEqual(headshotSources(OURS, 168, 96), {
		src: copy('4429795', 240),
		srcset: [135, 240, 270, 480]
			.map(keptWidth)
			.map((w) => `${copy('4429795', w)} ${String(w)}w`)
			.join(', '),
		sizes: '(max-width: 760px) 135px, 236px'
	});
});

void test("a provider headshot saved before the copies is read as our copy of the same id, never the provider's", () => {
	assert.deepEqual(headshotSources(NFL, 40), headshotSources(OURS, 40));
	const college = headshotSources(COLLEGE, 40);
	assert.ok(college);
	assert.equal(college.src, copy('4708490', 64));
	assert.ok(!(college.srcset ?? '').includes('espncdn'));
});

void test('an image off our origin that names no copy is no face; our own paths pass as they are', () => {
	assert.equal(
		headshotSources('https://a.espncdn.com/combiner/i?img=/i/headshots/nophoto.png', 40),
		null
	);
	assert.equal(headshotSources('https://example.com/4429795.png', 40), null);
	assert.equal(headshotSources('//example.com/4429795.png', 40), null);
	assert.deepEqual(headshotSources('/img/clubs/nfl/kc/64', 40), { src: '/img/clubs/nfl/kc/64' });
});

void test('the kept widths cover every drawn width without a step down', () => {
	assert.deepEqual([...HEADSHOT_WIDTHS], [48, 64, 96, 128, 160, 240, 320, 480]);
	assert.equal(keptWidth(31), 48);
	assert.equal(keptWidth(48), 48);
	assert.equal(keptWidth(49), 64);
	assert.equal(keptWidth(472), 480);
	assert.equal(keptWidth(900), 480);
});

void test("the share card's face is the copy's absolute address; a foreign one is none", () => {
	assert.equal(headshotAt(OURS, 480), copy('4429795', 480));
	assert.equal(headshotAt(NFL, 480), copy('4429795', 480));
	assert.equal(headshotAt('https://example.com/x.png', 480), null);
});

void test("the previous web's route keeps its upstream for one deploy", () => {
	assert.ok(isHeadshotLeague('college-football'));
	assert.ok(!isHeadshotLeague('nba'));
	assert.equal(
		upstreamHeadshotUrl('college-football', '4708490', 112),
		'https://a.espncdn.com/combiner/i?img=%2Fi%2Fheadshots%2Fcollege-football%2Fplayers%2Ffull%2F4708490.png&w=112&h=81'
	);
});
