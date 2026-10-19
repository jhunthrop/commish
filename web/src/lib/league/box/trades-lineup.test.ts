// Trades follows Lineup (Lane 66u, sweep X8): on the fixture league no trade drops a player the
// Lineup screen starts this week unless the trade says who takes his spot. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { LineupAdvice, TradeAdvice, WaiverAdvice } from '../inseason/api.ts';

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

void test("the fixture's drop panel hides no one the member could drop, this week's starters marked", () => {
	const lineup = load('lineup') as LineupAdvice;
	const waivers = load('waivers') as WaiverAdvice;
	// A spot no one who can play fills keeps its player in place, never a start this week.
	const starters = new Set(
		lineup.slots.filter((s) => !s.no_one_can_play).map((s) => s.ours.player.host_id)
	);
	const droppable = [...lineup.slots.map((s) => s.ours), ...lineup.bench]
		.filter((l) => !l.held)
		.map((l) => l.player.host_id)
		.sort();
	const skill = waivers.rows.find((r) => r.add.player.position !== 'DEF');
	assert.ok(skill, 'the fixture has no skill add');
	assert.deepEqual(skill.drops.map((d) => d.host_id).sort(), droppable);
	for (const d of skill.drops) assert.equal(d.starts_this_week, starters.has(d.host_id), d.host_id);
});
