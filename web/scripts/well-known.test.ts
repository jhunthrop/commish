// The app-link association files (Lane 172): the Apple team id and the Android certificate digest
// come from repository variables at build, and an empty variable writes a file that claims nothing.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	ANDROID_PACKAGE,
	APP_LINK_PATHS,
	IOS_BUNDLE_ID,
	appleAppSiteAssociation,
	assetLinks,
	writeWellKnown
} from './well-known.ts';

const TEAM = 'ABCDE12345';
const DIGEST = Array.from({ length: 32 }, (_, i) =>
	i.toString(16).padStart(2, '0').toUpperCase()
).join(':');

interface Aasa {
	applinks: { details: { appIDs: string[]; paths: string[]; components: { '/': string }[] }[] };
	webcredentials?: { apps: string[] };
}

interface AssetLink {
	relation: string[];
	target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}

void test('the Apple file names the iOS app under the team and every path the app opens', () => {
	const aasa = appleAppSiteAssociation(TEAM) as Aasa;
	const detail = aasa.applinks.details[0];
	assert.ok(detail);
	assert.deepEqual(detail.appIDs, [`${TEAM}.${IOS_BUNDLE_ID}`]);
	assert.equal(`${TEAM}.${IOS_BUNDLE_ID}`, 'ABCDE12345.app.trycommish.ios');
	assert.deepEqual(aasa.webcredentials, { apps: [`${TEAM}.${IOS_BUNDLE_ID}`] });
	for (const path of ['/app/signed-in', '/players/*', '/league/*', '/mock/share/*']) {
		assert.ok(detail.paths.includes(path), path);
		assert.ok(
			detail.components.some((c) => c['/'] === path),
			path
		);
	}
	assert.deepEqual(detail.paths, [...APP_LINK_PATHS]);
});

void test('the Android file names the Android app with the certificate digest', () => {
	const links = assetLinks(DIGEST) as AssetLink[];
	assert.equal(links.length, 1);
	const link = links[0];
	assert.ok(link);
	assert.deepEqual(link.relation, ['delegate_permission/common.handle_all_urls']);
	assert.equal(link.target.namespace, 'android_app');
	assert.equal(link.target.package_name, ANDROID_PACKAGE);
	assert.equal(ANDROID_PACKAGE, 'app.trycommish.android');
	assert.deepEqual(link.target.sha256_cert_fingerprints, [DIGEST]);
});

void test('a lower-case digest is written upper case, and two digests (upload and Play signing) both', () => {
	const other = DIGEST.replace(/^00/, 'FF');
	const links = assetLinks(`${DIGEST.toLowerCase()}, ${other}`) as AssetLink[];
	assert.deepEqual(links[0]?.target.sha256_cert_fingerprints, [DIGEST, other]);
});

void test('empty variables write files that claim no app', () => {
	for (const empty of ['', '   ']) {
		assert.deepEqual(appleAppSiteAssociation(empty), { applinks: { details: [] } });
		assert.deepEqual(assetLinks(empty), []);
	}
});

void test('a malformed value fails the build rather than claiming a wrong app', () => {
	for (const bad of ['ABCDE1234', 'abcde12345', 'ABCDE12345.app']) {
		assert.throws(() => appleAppSiteAssociation(bad), /APPLE_TEAM_ID/);
	}
	for (const bad of ['AB:CD', DIGEST.replaceAll(':', ''), `${DIGEST}:00`]) {
		assert.throws(() => assetLinks(bad), /ANDROID_CERT_SHA256/);
	}
});

void test('the files are written as JSON under .well-known, the Apple one with no extension', () => {
	const dir = mkdtempSync(join(tmpdir(), 'well-known-'));
	try {
		writeWellKnown({ APPLE_TEAM_ID: TEAM, ANDROID_CERT_SHA256: DIGEST }, dir);
		const aasa = JSON.parse(
			readFileSync(join(dir, '.well-known', 'apple-app-site-association'), 'utf8')
		) as Aasa;
		assert.deepEqual(aasa.applinks.details[0]?.appIDs, [`${TEAM}.${IOS_BUNDLE_ID}`]);
		const links = JSON.parse(
			readFileSync(join(dir, '.well-known', 'assetlinks.json'), 'utf8')
		) as AssetLink[];
		assert.equal(links[0]?.target.package_name, ANDROID_PACKAGE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

void test('the committed files are the empty-variable output', () => {
	const read = (name: string): string =>
		readFileSync(new URL(`../static/.well-known/${name}`, import.meta.url), 'utf8');
	assert.deepEqual(JSON.parse(read('apple-app-site-association')), appleAppSiteAssociation(''));
	assert.deepEqual(JSON.parse(read('assetlinks.json')), assetLinks(''));
});
