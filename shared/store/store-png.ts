/**
 * The check both stores' graphics share (apps/android/scripts/store-graphics.ts for Play,
 * apps/ios/scripts/store-shots.ts for the App Store): each PNG's header read for its size, its bit depth
 * and whether it carries alpha (a channel, or a transparency chunk), and its bytes against the store's
 * limit. Nothing here talks to a store.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** PNG colour types (the IHDR byte): RGB with no alpha channel, and RGB with one. */
const RGB = 2;
const RGBA = 6;
export const KB = 1024;
export const MB = KB * KB;

export interface Expected {
	file: string;
	width: number;
	height: number;
	alpha: boolean;
	maxBytes: number;
}

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

/** What is wrong with one file against what the store (named in the messages) takes, empty when nothing is. */
export function problemsOf(expected: Expected, bytes: Uint8Array, store: string): string[] {
	const { file, width, height, alpha, maxBytes } = expected;
	let header: PngHeader;
	try {
		header = readPngHeader(bytes);
	} catch (error) {
		return [`${file}: ${(error as Error).message}`];
	}
	const problems: string[] = [];
	if (header.width !== width || header.height !== height) problems.push(`${file}: ${header.width} x ${header.height}, ${store} takes ${width} x ${height}`);
	if (header.bitDepth !== 8) problems.push(`${file}: ${header.bitDepth} bits a channel, not 8`);
	const wanted = alpha ? RGBA : RGB;
	if (header.colorType !== wanted) problems.push(`${file}: colour type ${header.colorType}, wanted ${alpha ? '32-bit RGBA' : '24-bit RGB with no alpha'}`);
	if (!alpha && header.transparency) problems.push(`${file}: carries a transparency chunk`);
	if (bytes.length > maxBytes) problems.push(`${file}: ${bytes.length} bytes, ${store} takes at most ${maxBytes}`);
	return problems;
}

/** Every problem across a folder's files, a missing file among them. */
export function checkFolder(dir: string, expected: readonly Expected[], store: string): string[] {
	return expected.flatMap((one) => {
		let bytes: Uint8Array;
		try {
			bytes = readFileSync(join(dir, one.file));
		} catch {
			return [`${one.file}: missing`];
		}
		return problemsOf(one, bytes, store);
	});
}
