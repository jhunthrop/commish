/**
 * The Play store graphics in docs/store/play-graphics (docs/store/2026-10-26-play-listing.md §6), drawn by
 * the app's own Compose screens over the shared fixtures (the :storeshots module, Paparazzi):
 *
 *   node apps/android/scripts/store-graphics.ts           draw every file again, then check them
 *   node apps/android/scripts/store-graphics.ts --check   check the committed files only (exit 1 on a problem)
 *
 * The check reads each PNG's header: its size, and that the screenshots and the feature graphic carry no
 * alpha (24-bit RGB, no transparency chunk) while the icon does (32-bit RGBA), each under Play's file limit.
 * Nothing here talks to Play: the files are uploaded in the console by hand.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ANDROID = resolve(import.meta.dirname, '..');
export const GRAPHICS = resolve(ANDROID, '../../docs/store/play-graphics');

/** PNG colour types (the IHDR byte): RGB with no alpha channel, and RGB with one. */
const RGB = 2;
const RGBA = 6;
const KB = 1024;
const MB = KB * KB;

export interface Expected {
	file: string;
	width: number;
	height: number;
	alpha: boolean;
	maxBytes: number;
}

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

export interface PngHeader {
	width: number;
	height: number;
	bitDepth: number;
	colorType: number;
	transparency: boolean;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The IHDR fields of a PNG, and whether any chunk before the image data adds transparency (tRNS). */
export function readPngHeader(bytes: Uint8Array): PngHeader {
	if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const type = (at: number): string => String.fromCharCode(...bytes.subarray(at + 4, at + 8));
	if (type(8) !== 'IHDR') throw new Error('the first chunk is not IHDR');
	const header = { width: view.getUint32(16), height: view.getUint32(20), bitDepth: bytes[24], colorType: bytes[25], transparency: false };
	for (let at = 8; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
		const name = type(at);
		if (name === 'tRNS') header.transparency = true;
		if (name === 'IDAT' || name === 'IEND') break;
	}
	return header;
}

/** What is wrong with one file against what Play takes, empty when nothing is. */
export function problemsOf(expected: Expected, bytes: Uint8Array): string[] {
	const { file, width, height, alpha, maxBytes } = expected;
	let header: PngHeader;
	try {
		header = readPngHeader(bytes);
	} catch (error) {
		return [`${file}: ${(error as Error).message}`];
	}
	const problems: string[] = [];
	if (header.width !== width || header.height !== height) problems.push(`${file}: ${header.width} x ${header.height}, Play takes ${width} x ${height}`);
	if (header.bitDepth !== 8) problems.push(`${file}: ${header.bitDepth} bits a channel, not 8`);
	const wanted = alpha ? RGBA : RGB;
	if (header.colorType !== wanted) problems.push(`${file}: colour type ${header.colorType}, wanted ${alpha ? '32-bit RGBA' : '24-bit RGB with no alpha'}`);
	if (!alpha && header.transparency) problems.push(`${file}: carries a transparency chunk`);
	if (bytes.length > maxBytes) problems.push(`${file}: ${bytes.length} bytes, Play takes at most ${maxBytes}`);
	return problems;
}

/** Every problem across the folder's files, a missing file among them. */
export function checkGraphics(dir: string = GRAPHICS): string[] {
	return EXPECTED.flatMap((expected) => {
		let bytes: Uint8Array;
		try {
			bytes = readFileSync(join(dir, expected.file));
		} catch {
			return [`${expected.file}: missing`];
		}
		return problemsOf(expected, bytes);
	});
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
