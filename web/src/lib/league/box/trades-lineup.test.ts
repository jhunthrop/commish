// Trades follows Lineup (Lane 66u, sweep X8): on the fixture league no trade drops a player the
// Lineup screen starts this week unless the trade says who takes his spot. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { LineupAdvice, TradeAdvice } from '../inseason/api.ts';

const DATA = new URL('../../../../scripts/inseason-fixture/data/', import.meta.url);

function load<T>(name: string): T {
	return JSON.parse(readFileSync(new URL(`${name}.json`, DATA), 'utf8')) as T;
}

void test('no trade in the fixture drops a starter the Lineup screen sets', () => {
	const lineup = load<LineupAdvice>('lineup');
	const trades = load<TradeAdvice>('trades');
	const starters = new Set(
		lineup.slots.filter((s) => !s.no_one_can_play).map((s) => s.ours.player.host_id)
	);
	const rows = trades.teams.flatMap((team) => team.trades);
	const drops = rows.filter((row) => row.drop !== null);
	assert.ok(drops.length > 0, 'the fixture has no trade that grows the roster');
	for (const row of drops) {
		const name = row.drop?.player.name ?? '';
		if (starters.has(row.drop?.player.host_id ?? '')) {
			assert.equal(typeof row.drop_reason, 'string', `${name} starts this week and the trade drops him`);
		} else {
			assert.equal(row.drop_reason, null, `${name} is on the bench and the trade explains his spot`);
		}
	}
});
