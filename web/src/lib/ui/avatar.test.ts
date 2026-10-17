// The avatar route's rules (Lane 66i review M4): which images it serves, how large, how long it
// waits, and the headers it serves them with. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	AVATAR_HEADERS,
	AVATAR_MAX_BYTES,
	avatarCacheKey,
	avatarSrc,
	rasterType,
	tooLarge,
	upstreamAvatarUrl
} from './avatar.ts';

void test('only raster images are served, never an SVG or anything else', () => {
	for (const type of [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'IMAGE/PNG; charset=x'
	]) {
		assert.ok(rasterType(type), type);
	}
	assert.equal(rasterType('image/png; charset=binary'), 'image/png');
	for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', '', null]) {
		assert.equal(rasterType(type), null, String(type));
	}
});

void test('an avatar over the cap is refused, by its stated length or its bytes', () => {
	assert.equal(AVATAR_MAX_BYTES, 256 * 1024);
	assert.equal(tooLarge('1000', 1000), false);
	assert.equal(tooLarge(String(AVATAR_MAX_BYTES + 1), 10), true, 'a stated length over the cap');
	assert.equal(tooLarge(null, AVATAR_MAX_BYTES + 1), true, 'bytes over the cap');
	assert.equal(tooLarge(null, AVATAR_MAX_BYTES), false);
});

void test('an avatar is served sandboxed, no type guessed, and cached by its path alone', () => {
	assert.equal(AVATAR_HEADERS['content-security-policy'], "default-src 'none'; sandbox");
	assert.equal(AVATAR_HEADERS['x-content-type-options'], 'nosniff');
	assert.equal(
		avatarCacheKey('https://trycommish.app/img/avatars/sleeper/abc?x=1#y'),
		'https://trycommish.app/img/avatars/sleeper/abc'
	);
});

void test('a Sleeper avatar is asked of our origin, and nothing else is', () => {
	const id = '2aea7c4ff143abb0f01f2ddbec933afc';
	assert.equal(
		avatarSrc(`https://sleepercdn.com/avatars/thumbs/${id}`),
		`/img/avatars/sleeper/${id}`
	);
	assert.equal(avatarSrc('https://evil.example/avatars/thumbs/' + id), null);
	assert.equal(avatarSrc(null), null);
	assert.equal(upstreamAvatarUrl('sleeper', id), `https://sleepercdn.com/avatars/thumbs/${id}`);
});
