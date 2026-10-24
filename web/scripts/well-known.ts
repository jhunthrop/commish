// Writes the app-link association files under static/.well-known (Lane 172): apple-app-site-association
// for the iOS app's universal links and assetlinks.json for the Android app's verified links, from the
// repository variables APPLE_TEAM_ID and ANDROID_CERT_SHA256 (comma-separated for more than one
// signing key). An empty variable writes a file that claims nothing, which is what is committed, so a
// build without them serves no claim. web/_headers serves both as application/json.
// Usage: node scripts/well-known.ts   (the build runs it; well-known.test.ts holds the shapes)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SIGNED_IN_PATH } from '../src/lib/site/app-words.ts';

export const IOS_BUNDLE_ID = 'app.trycommish.ios';
export const ANDROID_PACKAGE = 'app.trycommish.android';

/** The site's paths the apps open in place of the browser: the sign-in return, a player, a league
 * and a shared mock (the mobile spec §6). */
export const APP_LINK_PATHS = [
	APP_SIGNED_IN_PATH,
	'/players/*',
	'/league/*',
	'/mock/share/*'
] as const;

const TEAM_ID = /^[A-Z0-9]{10}$/;
const CERT_DIGEST = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

/** The variables the files are written from. */
export interface WellKnownEnv {
	APPLE_TEAM_ID?: string | undefined;
	ANDROID_CERT_SHA256?: string | undefined;
}

/** The Apple file: the iOS app under the team for every app-link path, in both the paths form and
 * the components form iOS reads, and under webcredentials, which lets the app's sign-in sheet take
 * its https return (ASWebAuthenticationSession's https callback, iOS 17.4). No team, no app. */
export function appleAppSiteAssociation(teamId: string): object {
	const team = teamId.trim();
	if (team === '') return { applinks: { details: [] } };
	if (!TEAM_ID.test(team)) {
		throw new Error(`APPLE_TEAM_ID must be the ten-character Apple team id, got "${team}"`);
	}
	return {
		applinks: {
			details: [
				{
					appIDs: [`${team}.${IOS_BUNDLE_ID}`],
					paths: [...APP_LINK_PATHS],
					components: APP_LINK_PATHS.map((path) => ({ '/': path }))
				}
			]
		},
		webcredentials: { apps: [`${team}.${IOS_BUNDLE_ID}`] }
	};
}

/** The Android file: the Android app with each signing certificate's SHA-256, upper case. No
 * digest, no app. */
export function assetLinks(digests: string): object[] {
	const fingerprints = digests
		.split(',')
		.map((d) => d.trim().toUpperCase())
		.filter((d) => d !== '');
	if (fingerprints.length === 0) return [];
	const bad = fingerprints.find((d) => !CERT_DIGEST.test(d));
	if (bad !== undefined) {
		throw new Error(`ANDROID_CERT_SHA256 must be 32 colon-separated hex bytes, got "${bad}"`);
	}
	return [
		{
			relation: [HANDLE_ALL_URLS],
			target: {
				namespace: 'android_app',
				package_name: ANDROID_PACKAGE,
				sha256_cert_fingerprints: fingerprints
			}
		}
	];
}

/** Writes both files under dir/.well-known. */
export function writeWellKnown(env: WellKnownEnv, dir: string): void {
	const out = join(dir, '.well-known');
	mkdirSync(out, { recursive: true });
	const json = (value: unknown): string => `${JSON.stringify(value, null, '\t')}\n`;
	writeFileSync(
		join(out, 'apple-app-site-association'),
		json(appleAppSiteAssociation(env.APPLE_TEAM_ID ?? ''))
	);
	writeFileSync(join(out, 'assetlinks.json'), json(assetLinks(env.ANDROID_CERT_SHA256 ?? '')));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const staticDir = fileURLToPath(new URL('../static', import.meta.url));
	const { APPLE_TEAM_ID, ANDROID_CERT_SHA256 } = process.env;
	writeWellKnown({ APPLE_TEAM_ID, ANDROID_CERT_SHA256 }, staticDir);
	process.stdout.write(`${join(staticDir, '.well-known')}\n`);
}
