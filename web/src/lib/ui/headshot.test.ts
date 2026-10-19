// Every face loads from our image route at its drawn size (spec §2.5, the sweep's C15): the
// provider's NFL headshots and its college ones a rookie's page still carries, never the provider's
// 600 px file. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEADSHOT_ROUTE, headshotSources, isHeadshotLeague } from './headshot.ts';
import { upstreamHeadshotUrl } from './headshot-provider.ts';

const NFL = 'https://a.espncdn.com/i/headshots/nfl/players/full/4429795.png';
const COLLEGE = 'https://a.espncdn.com/i/headshots/college-football/players/full/4708490.png';

void test('an NFL headshot is asked of our route at its drawn width, 1x and 2x', () => {
	assert.deepEqual(headshotSources(NFL, 40), {
		src: `${HEADSHOT_ROUTE}/nfl/4429795/56`,
		srcset: `${HEADSHOT_ROUTE}/nfl/4429795/56 1x, ${HEADSHOT_ROUTE}/nfl/4429795/112 2x`
	});
});

void test("a college headshot goes through our route too, never the provider's full file (the club page's 305 KB face)", () => {
	const sources = headshotSources(COLLEGE, 40);
	assert.equal(sources.src, `${HEADSHOT_ROUTE}/college-football/4708490/56`);
	assert.ok(!sources.srcset?.includes('espncdn'));
	assert.ok(isHeadshotLeague('college-football'));
	assert.equal(
		upstreamHeadshotUrl('college-football', '4708490', 112),
		'https://a.espncdn.com/combiner/i?img=%2Fi%2Fheadshots%2Fcollege-football%2Fplayers%2Ffull%2F4708490.png&w=112&h=81'
	);
});

void test('a face that is no provider headshot passes as it is', () => {
	assert.deepEqual(headshotSources('/img/clubs/nfl/kc/64', 40), { src: '/img/clubs/nfl/kc/64' });
	assert.ok(!isHeadshotLeague('nba'));
});
