// A club's mark comes from our own origin at the size it is drawn (Lane 66w): never the image host's
// 500 px file. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLUB_MARK_WIDTH, clubMark, clubMarkPath, isClubCode } from './club-mark.ts';
import { upstreamClubMarkUrl } from './headshot-provider.ts';

void test('a mark is our route at the drawn width, twice the 32 px circle', () => {
	assert.equal(clubMark('TEN'), '/img/clubs/nfl/ten/64');
	assert.equal(clubMark('wsh', 40), '/img/clubs/nfl/wsh/40');
	assert.equal(CLUB_MARK_WIDTH, 64);
	assert.ok(!clubMark('HOU').includes('espncdn'));
});

void test("the route's path reads back to the club and width, and refuses anything else", () => {
	assert.deepEqual(clubMarkPath('/img/clubs/nfl/buf/64'), {
		league: 'nfl',
		club: 'buf',
		width: 64
	});
	for (const bad of [
		'/img/clubs/nfl/buffalo/64',
		'/img/clubs/nfl/b1/64',
		'/img/clubs/nba/buf/64',
		'/img/clubs/nfl/buf/8',
		'/img/clubs/nfl/buf/2000',
		'/img/clubs/nfl/buf/64.5'
	]) {
		assert.equal(clubMarkPath(bad), null, bad);
	}
	assert.ok(isClubCode('lac') && !isClubCode('../x'));
});

void test('the upstream is the image host resized to the drawn width, square', () => {
	const url = new URL(upstreamClubMarkUrl('nfl', 'ten', 64));
	assert.equal(url.origin, 'https://a.espncdn.com');
	assert.equal(url.searchParams.get('img'), '/i/teamlogos/nfl/500/ten.png');
	assert.equal(url.searchParams.get('w'), '64');
	assert.equal(url.searchParams.get('h'), '64');
});
