/**
 * The Play store graphics in docs/store/play-graphics (docs/store/2026-10-26-play-listing.md §6), drawn by
 * the app's own Compose screens over the shared fixtures (the :storeshots module, Paparazzi):
 *
 *   node apps/android/scripts/store-graphics.ts           draw every file again, then check them
 *   node apps/android/scripts/store-graphics.ts --check   check the committed files only (exit 1 on a problem)
 *
 * The check reads each PNG's header: its size, and that the screenshots and the feature graphic carry no
 * alpha (24-bit RGB, no transparency chunk) while the icon does (32-bit RGBA), each under Play's file limit
 * (the reader is shared with the App Store's check: shared/store/store-png.ts); and each phone shot's
 * scene strings, which must name no platform (shared/store/scene-strings.ts, Lane 310).
 * Nothing here talks to Play: the files are uploaded in the console by hand.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkSceneStrings } from '../../../shared/store/scene-strings.ts';
import { checkFolder, type Expected, KB, MB, problemsOf as storeProblems } from '../../../shared/store/store-png.ts';

export { readPngHeader } from '../../../shared/store/store-png.ts';
export type { Expected } from '../../../shared/store/store-png.ts';

const ANDROID = resolve(import.meta.dirname, '..');
export const GRAPHICS = resolve(ANDROID, '../../docs/store/play-graphics');
const STORE = 'Play';

const shot = (file: string): Expected => ({ file, width: 1080, height: 1920, alpha: false, maxBytes: 8 * MB });

/** Every file the listing needs, in the order the README lists them. */
export const EXPECTED: readonly Expected[] = [
	{ file: 'icon-512.png', width: 512, height: 512, alpha: true, maxBytes: KB * KB },
	{ file: 'feature-graphic.png', width: 1024, height: 500, alpha: false, maxBytes: 15 * MB },
	shot('phone-1-lineup.png'),
	shot('phone-2-waivers.png'),
	shot('phone-3-trades.png'),
	shot('phone-4-matchup.png'),
	shot('phone-5-rankings.png'),
	shot('phone-6-board.png'),
	shot('phone-7-mock-room.png'),
	shot('phone-8-player-page.png')
];

/** What is wrong with one file against what Play takes, empty when nothing is (shared/store/store-png.ts). */
export function problemsOf(expected: Expected, bytes: Uint8Array): string[] {
	return storeProblems(expected, bytes, STORE);
}

/** The phone shots, by the name their scene strings are written under. */
export const SHOTS: readonly string[] = EXPECTED.filter((e) => e.file.startsWith('phone-')).map((e) => e.file.replace(/\.png$/, ''));

/** Every problem across the folder's files, a missing file among them, and any platform a phone shot's
 * scene strings name. */
export function checkGraphics(dir: string = GRAPHICS): string[] {
	return [...checkFolder(dir, EXPECTED, STORE), ...checkSceneStrings(dir, SHOTS)];
}

/** Draws every file again through the :storeshots tests, writing straight into the folder. */
function draw(): void {
	execFileSync('./gradlew', [':storeshots:testDebugUnitTest', `-PstoreGraphics=${GRAPHICS}`, '--quiet'], {
		cwd: ANDROID,
		stdio: 'inherit'
	});
}

if (import.meta.main) {
	if (!process.argv.includes('--check')) draw();
	const problems = checkGraphics();
	for (const problem of problems) console.error(problem);
	if (problems.length > 0) process.exit(1);
	console.log(`${EXPECTED.length} store graphics in ${GRAPHICS}: each its size, the icon with alpha, the rest without.`);
}
