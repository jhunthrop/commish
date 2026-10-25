// The fixture's box for another roster's game (Lane 204), as the API's matchup.go draws it with
// ?roster=: that roster's side first, its opponent's second, the league's slots, no standing. Run
// with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type {
	LineupAdvice,
	MatchupBox,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import { askedRoster, otherGameBox, otherGameLines, TAPPED_ROSTER } from './other-game.ts';
import { linesOf, recordedMatchups } from './scoreboard-at.ts';

const data = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`data/${name}.json`, import.meta.url), 'utf8'));
const box = data('matchup') as MatchupBox;
const matchups = await recordedMatchups();
const week = {
	me: box.sides[0]?.roster_id ?? 0,
	matchups,
	lines: linesOf(
		{
			lineup: data('lineup') as LineupAdvice,
			waivers: data('waivers') as WaiverAdvice,
			trades: data('trades') as TradeAdvice,
			matchup: box
		},
		await otherGameLines()
	)
};

void test("another roster's box is its game, its side first, in the league's slots", () => {
	const other = matchups.find((m) => m.roster_id === TAPPED_ROSTER);
	assert.ok(other);
	const drawn = otherGameBox(other.roster_id, week, box);
	assert.ok(drawn);
	const opponent = matchups.find(
		(m) => m.matchup_id === other.matchup_id && m.roster_id !== other.roster_id
	);
	assert.deepEqual(
		drawn.sides.map((s) => s.roster_id),
		[other.roster_id, opponent?.roster_id]
	);
	assert.equal(drawn.viewer_side, 'other');
	assert.equal(drawn.standing, null);
	// Each starter in the slot of his place among the recorded starters (the league's slot order); a
	// starter no recorded answer holds a line for is left out, as the scoreboard counts him (the
	// fixture holds every line of the member's game alone).
	const slots = box.sides[0]?.starters.map((s) => s.slot) ?? [];
	for (const side of drawn.sides) {
		const recorded = matchups.find((m) => m.roster_id === side.roster_id)?.starters ?? [];
		assert.ok(side.starters.length > 0, `roster ${String(side.roster_id)} starts nobody`);
		for (const s of side.starters)
			assert.equal(s.slot, slots[recorded.indexOf(s.line.player.host_id)], s.line.player.name);
		const starting = new Set(side.starters.map((s) => s.line.player.host_id));
		assert.ok(side.bench.every((l) => !starting.has(l.player.host_id)));
	}
});

void test("the member's own roster draws the member's game, an unlisted one nothing", () => {
	const mine = otherGameBox(week.me, week, box);
	assert.deepEqual(
		mine?.sides.map((s) => s.roster_id),
		box.sides.map((s) => s.roster_id)
	);
	assert.equal(otherGameBox(99, week, box), null);
});

void test('the asked roster is refused as the API refuses it', () => {
	assert.equal(askedRoster(new URLSearchParams('')), null);
	assert.equal(askedRoster(new URLSearchParams('roster=4')), 4);
	for (const bad of ['roster=', 'roster=x', 'roster=-1', 'roster=1.5'])
		assert.equal(askedRoster(new URLSearchParams(bad)), 'invalid', bad);
});

void test('the game the shots tap is whole: every starter of both sides in a slot, the bench after (review 204 M2)', () => {
	const drawn = otherGameBox(TAPPED_ROSTER, week, box);
	assert.ok(drawn);
	for (const side of drawn.sides) {
		const recorded = matchups.find((m) => m.roster_id === side.roster_id);
		assert.equal(
			side.starters.length,
			recorded?.starters.length,
			`roster ${String(side.roster_id)}`
		);
		assert.ok(side.bench.length > 0, `roster ${String(side.roster_id)} has no bench`);
	}
});
