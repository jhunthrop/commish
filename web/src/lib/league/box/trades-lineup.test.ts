// Trades follows Lineup (Lane 66u, sweep X8): on the fixture league no trade drops a player the
// Lineup screen starts this week unless the trade says who takes his spot. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { LineupAdvice, TradeAdvice } from '../inseason/api.ts';

const DATA = new URL('../../../../scripts/inseason-fixture/data/', import.meta.url);

function load(name: string): unknown {
	return JSON.parse(readFileSync(new URL(`${name}.json`, DATA), 'utf8'));
}

void test('no trade in the fixture drops a starter the Lineup screen sets without saying who starts for him', () => {
	const lineup = load('lineup') as LineupAdvice;
	const trades = load('trades') as TradeAdvice;
	const starters = new Set(
		lineup.slots.filter((s) => !s.no_one_can_play).map((s) => s.ours.player.host_id)
	);
	const rows = trades.teams.flatMap((team) => team.trades);
	const drops = rows.filter((row) => row.drop !== null);
	assert.ok(drops.length > 0, 'the fixture has no trade that grows the roster');
	for (const row of drops) {
		const name = row.drop?.player.name ?? '';
		if (starters.has(row.drop?.player.host_id ?? '')) {
			assert.equal(
				typeof row.drop_reason,
				'string',
				`${name} starts this week and the trade drops him`
			);
		} else {
			assert.equal(
				row.drop_reason,
				null,
				`${name} is on the bench and the trade explains his spot`
			);
		}
	}
	// The one stand-in starter drop (project.ts STARTER_DROP_STANDIN) names its slot and the man who
	// starts in his place, so a shot shows the sentence (review 66u finding 3).
	const said = drops.filter((row) => row.drop_reason !== null);
	assert.equal(said.length, 1, 'the fixture has no starter drop to show its sentence');
	assert.equal(
		said[0]?.drop_reason,
		'Williams starts at WR3 for you this week. After the trade Tucker starts at Flex 1 and your lineup stays full.'
	);
});
