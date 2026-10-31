/**
 * The App Store screenshots in docs/store/app-store-graphics (docs/store/2026-10-26-app-store-listing.md
 * §2), drawn by the app's own SwiftUI screens over the shared fixtures (the StoreShots package):
 *
 *   node apps/ios/scripts/store-shots.ts                 draw every file again, then check them
 *   node apps/ios/scripts/store-shots.ts --out <folder>  draw into another folder (a preview), then check it
 *   node apps/ios/scripts/store-shots.ts --check         check the committed files only (exit 1 on a problem)
 *
 * The committed files are CI's: ios.yml's store_shots dispatch draws them on macos-26 with the pinned
 * Xcode and uploads them as the app-store-graphics artifact. Drawing copies shared/fixtures with the
 * recorded league's names replaced (shared/store/store-names.json, the Play set's file) and runs the
 * package's tests with STORE_SHOTS naming the folder and COMMISH_FIXTURES the copy. The check reads each
 * PNG's header: its exact size and no alpha (24-bit RGB, no transparency chunk), under the store's limit.
 * Nothing here talks to App Store Connect: the files are uploaded by hand.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkFolder, type Expected, MB } from '../../../shared/store/store-png.ts';

const IOS = resolve(import.meta.dirname, '..');
const ROOT = resolve(IOS, '../..');
export const GRAPHICS = resolve(ROOT, 'docs/store/app-store-graphics');
const FIXTURES = resolve(ROOT, 'shared/fixtures');
const NAMES = resolve(ROOT, 'shared/store/store-names.json');
const PACKAGE = resolve(IOS, 'Packages/StoreShots');
const STORE = 'the App Store';
/** App Store Connect's limit for a screenshot file. */
const MAX_BYTES = 10 * MB;

/** The two iPhone sizes, by the file's prefix (StoreDevice in the package). */
const SIZES = { medium: [1206, 2622], large: [1320, 2868] } as const;
/** The eight shots in the listing's order (Play listing §1.2), by the file's stem (StoreShot.stem). */
export const STEMS = ['1-lineup', '2-waivers', '3-trades', '4-matchup', '5-rankings', '6-board', '7-mock-room', '8-player-page'] as const;

/** Every file the listing needs: the eight at the medium size, then at the large. */
export const EXPECTED: readonly Expected[] = Object.entries(SIZES).flatMap(([size, [width, height]]) =>
	STEMS.map((stem) => ({ file: `${size}-${stem}.png`, width, height, alpha: false, maxBytes: MAX_BYTES }))
);

/** Every problem across the folder's files, a missing file among them. */
export function checkShots(dir: string = GRAPHICS): string[] {
	return checkFolder(dir, EXPECTED, STORE);
}

type NamePair = readonly [from: string, to: string];

/** The made-up names, each pair applied in order as plain text (store-names.json says why). */
export function readNamePairs(file: string = NAMES): NamePair[] {
	const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
	const pairs = (parsed as { replace?: unknown }).replace;
	const valid = Array.isArray(pairs) && pairs.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((s) => typeof s === 'string'));
	if (!valid) throw new Error(`${file}: "replace" is not a list of [from, to] string pairs`);
	return pairs as NamePair[];
}

export function renamed(text: string, pairs: readonly NamePair[]): string {
	return pairs.reduce((out, [from, to]) => out.replaceAll(from, to), text);
}

/** Rewrites every JSON file under `dir` with the names replaced. */
function renameTree(dir: string, pairs: readonly NamePair[]): void {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) renameTree(path, pairs);
		else if (entry.endsWith('.json')) writeFileSync(path, renamed(readFileSync(path, 'utf8'), pairs));
	}
}

/** Draws every shot into `out` through the package's gated tests, over a renamed copy of the fixtures. */
function draw(out: string): void {
	const copy = mkdtempSync(join(tmpdir(), 'store-fixtures-'));
	try {
		cpSync(FIXTURES, copy, { recursive: true });
		renameTree(copy, readNamePairs());
		execFileSync('swift', ['test', '--filter', 'StoreShotsTests'], {
			cwd: PACKAGE,
			stdio: 'inherit',
			env: { ...process.env, STORE_SHOTS: out, COMMISH_FIXTURES: copy }
		});
	} finally {
		rmSync(copy, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const at = args.indexOf('--out');
	const out = at >= 0 ? resolve(args[at + 1] ?? '') : GRAPHICS;
	if (at >= 0 && !args[at + 1]) throw new Error('--out names no folder');
	if (!args.includes('--check')) draw(out);
	const problems = checkShots(out);
	for (const problem of problems) console.error(problem);
	if (problems.length > 0) process.exit(1);
	console.log(`${EXPECTED.length} App Store screenshots in ${out}: each its size, none with alpha.`);
}
