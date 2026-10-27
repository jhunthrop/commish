/** The store graphics' check: the committed files pass it, and a PNG with the wrong size or alpha does not. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { checkGraphics, EXPECTED, problemsOf, readPngHeader } from './store-graphics.ts';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(Buffer.from(type, 'ascii'), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
	return out;
}

/** A blank PNG of a size and colour type, with a tRNS chunk when asked. */
function png(width: number, height: number, colorType: number, trns = false): Uint8Array {
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	ihdr.set([8, colorType, 0, 0, 0], 8);
	const channels = colorType === 6 ? 4 : 3;
	const rows = new Uint8Array(height * (1 + width * channels));
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		...(trns ? [chunk('tRNS', new Uint8Array(6))] : []),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', new Uint8Array())
	];
	return Buffer.concat(parts);
}

const shot = EXPECTED.find((e) => e.file === 'phone-1-lineup.png')!;
const icon = EXPECTED.find((e) => e.file === 'icon-512.png')!;

test('the committed store graphics are each the size Play takes, the icon alone with alpha', () => {
	assert.deepEqual(checkGraphics(), []);
});

test('the header reads the size and the colour type', () => {
	assert.deepEqual(readPngHeader(png(1080, 1920, 2)), { width: 1080, height: 1920, bitDepth: 8, colorType: 2, transparency: false });
	assert.equal(readPngHeader(png(4, 4, 2, true)).transparency, true);
});

test('a screenshot passes as 24-bit RGB and fails with alpha, a tRNS chunk or the wrong size', () => {
	assert.deepEqual(problemsOf(shot, png(1080, 1920, 2)), []);
	assert.match(problemsOf(shot, png(1080, 1920, 6))[0], /colour type 6/);
	assert.match(problemsOf(shot, png(1080, 1920, 2, true))[0], /transparency/);
	assert.match(problemsOf(shot, png(720, 960, 2))[0], /720 x 960/);
});

test('the icon passes as 32-bit RGBA and fails without alpha', () => {
	assert.deepEqual(problemsOf(icon, png(512, 512, 6)), []);
	assert.match(problemsOf(icon, png(512, 512, 2))[0], /32-bit RGBA/);
});

test('a file that is no PNG is named as such', () => {
	assert.deepEqual(problemsOf(shot, new Uint8Array([1, 2, 3])), ['phone-1-lineup.png: not a PNG']);
});

test('a missing file is a problem', () => {
	assert.ok(checkGraphics('/nonexistent-store-graphics').every((p) => p.endsWith(': missing')));
});
