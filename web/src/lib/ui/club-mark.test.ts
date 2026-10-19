// A club's mark comes from our own origin at the size it is drawn (Lane 66w): never the image host's
// 500 px file. The route serves the 32 clubs at the drawn widths only, and keys its edge cache on the
// path. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clubCodes } from '#lib/format/clubs.ts';
import { clubMarkPath, imageCacheKey } from '#lib/server/image-route.ts';
import { CLUB_MARK_WIDTH, clubMark } from './club-mark.ts';
import { upstreamClubMarkUrl } from './headshot-provider.ts';

void test('a mark is our route at the drawn width, twice the 32 px circle', () => {
	assert.equal(clubMark('TEN'), '/img/clubs/nfl/ten/64');
	assert.equal(CLUB_MARK_WIDTH, 64);
	assert.ok(!clubMark('HOU').includes('espncdn'));
});

void test('the route serves the 32 clubs at the drawn width, and no other path', () => {
	assert.equal(clubCodes().length, 32);
	for (const club of clubCodes()) {
		assert.deepEqual(clubMarkPath(clubMark(club)), {
			league: 'nfl',
			club: club.toLowerCase(),
			width: 64
		});
	}
	for (const bad of [
		'/img/clubs/nfl/buffalo/64',
		'/img/clubs/nfl/xx/64',
		'/img/clubs/nfl/was/64',
		'/img/clubs/nba/buf/64',
		'/img/clubs/nfl/buf/32',
		'/img/clubs/nfl/buf/65',
		'/img/clubs/nfl/buf/64.5'
	]) {
		assert.equal(clubMarkPath(bad), null, bad);
	}
});

void test('the edge cache keys on the path, never the query', () => {
	assert.equal(
		imageCacheKey(new URL('https://trycommish.app/img/clubs/nfl/buf/64?x=1')),
		'https://trycommish.app/img/clubs/nfl/buf/64'
	);
});

void test('the upstream is the image host resized to the drawn width, square', () => {
	const url = new URL(upstreamClubMarkUrl('nfl', 'ten', 64));
	assert.equal(url.origin, 'https://a.espncdn.com');
	assert.equal(url.searchParams.get('img'), '/i/teamlogos/nfl/500/ten.png');
	assert.equal(url.searchParams.get('w'), '64');
	assert.equal(url.searchParams.get('h'), '64');
});
