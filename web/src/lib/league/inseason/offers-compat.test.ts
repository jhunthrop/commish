// The trade finder's answer with and without `offers` (Lane 279): the field is additive, so the
// deployed web reads both answers the same way, and the generated type keeps it optional (an older
// API sends none). The web draws no offer yet. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldTrades } from '../box/trades.ts';
import type { TradeAdvice } from './api.ts';
import { openingPicks, presetsFrom } from './builder.ts';

type Offer = NonNullable<TradeAdvice['offers']>[number];

const offer: Offer = {
	label: 'Offered to you',
	roster_id: 2,
	name: 'The Hail Marys',
	give: ['h-1'],
	get: ['h-2'],
	drop: [],
	host_offer_id: '1002',
	expires_at: '2026-10-31T19:00:00Z',
	read_at: '2026-10-28T17:00:00Z'
};

// An older answer's shape: the type compiles with no offers at all.
const older: TradeAdvice['offers'] = undefined;

/** The screen's own read of one answer: its held rows, presets and opening picks. */
function screenRead(body: string): unknown {
	const advice = JSON.parse(body) as Pick<TradeAdvice, 'teams'>;
	const held = heldTrades(advice, Date.parse('2026-10-28T17:00:00Z'));
	const presets = presetsFrom(held.teams);
	return { presets, picks: openingPicks(presets) };
}

void test('an answer with offers reads as one without them', () => {
	const without = JSON.stringify({ teams: [] });
	const withOffers = JSON.stringify({ teams: [], offers: [offer] });
	assert.equal(older, undefined);
	assert.deepEqual(screenRead(withOffers), screenRead(without));
});
