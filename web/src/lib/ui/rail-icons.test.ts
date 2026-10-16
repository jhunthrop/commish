// The rail's glyphs ride in the page as a sprite, not in its script (spec 2026-10-16 §4: the rail
// stays inside the board's script budget). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ICONS } from './icons.ts';
import { LEAGUE_PHASES, RAIL_FOOT, RAIL_ITEMS, railIconId } from './nav.ts';
import { railFor } from './rail-order.ts';
import { RAIL_ICONS, railIconNames, railSprite } from './rail-icons.ts';

const sprite = railSprite();

void test('every rail item has its glyph in the sprite', () => {
	for (const item of [...RAIL_ITEMS, RAIL_FOOT]) {
		assert.ok(sprite.includes(`<symbol id="${railIconId(item.icon)}"`), item.icon);
	}
	for (const phase of LEAGUE_PHASES) {
		for (const entry of railFor(phase, true)) assert.ok(entry.icon in RAIL_ICONS, entry.icon);
	}
});

void test('the in-season glyphs are drawn in the set', () => {
	for (const name of ['lineup', 'matchup', 'waivers', 'trades'] as const) {
		assert.ok(RAIL_ICONS[name].length > 0);
		assert.ok(sprite.includes(`id="rail-${name}"`));
	}
	assert.ok(sprite.includes('<path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/>'));
	assert.ok(sprite.includes('<circle cx="7" cy="9" r="3"/>'));
});

void test("no rail glyph is in the page script's icon set", () => {
	for (const name of railIconNames()) assert.ok(!(name in ICONS), name);
	assert.ok(sprite.startsWith('<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true"'));
});
