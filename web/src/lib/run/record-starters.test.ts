// Starters right in a league's own lineup (Lane 93): with the standard lineup it is the run's own
// count, week by week and line by line, on the live record (scripts/record-fixture/record-live.json,
// what the nightly writes from the dev store on Monday night of week 6); a league's flex counts its
// players once. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	STANDARD_LINEUP,
	lineupFor,
	playersOf,
	startersRight,
	type StartingLineup
} from './record-starters.ts';
import { recordSchema, type PlacedPlayer } from './schema.ts';

const live = recordSchema.parse(
	JSON.parse(
		readFileSync(
			new URL('../../../scripts/record-fixture/record-live.json', import.meta.url),
			'utf8'
		)
	)
);

void test('with the standard lineup every graded line counts what the run counts', () => {
	const graded = live.weeks.filter((week) => week.status === 'graded');
	assert.deepEqual(
		graded.map((week) => week.week),
		[1, 2]
	);
	for (const week of graded) {
		const players = week.players ?? [];
		assert.ok(players.length > 0, `week ${String(week.week)} carries its players`);
		for (const line of week.lines) {
			for (const source of ['ours', 'adp'] as const) {
				const got = startersRight(
					playersOf(players, line.position),
					lineupFor(STANDARD_LINEUP, line.position),
					source
				);
				assert.deepEqual(
					got,
					{ right: line[source].starters, of: line[source].startersOf },
					`week ${String(week.week)} ${line.position} ${source}`
				);
			}
		}
	}
});

const ESPN_LINEUP: StartingLineup = { ...STANDARD_LINEUP, wr: 2, flex: 1 };

const player = (
	position: PlacedPlayer['position'],
	ours: number | null,
	finish: number
): PlacedPlayer => ({ position, ours, adp: null, published: null, finish });

void test("a league's flex is filled from the backs, receivers and tight ends left, each counted once", () => {
	// One team: QB, 2 RB, 2 WR, TE and a flex. We called RB r3 at the flex; he finished second among
	// the backs, a starter in the finish's own RB slots, so he counts once, as one of ours right.
	const lineup: StartingLineup = { ...ESPN_LINEUP, teams: 1 };
	const players = [
		player('QB', 1, 1),
		player('RB', 1, 2),
		player('RB', 2, 9),
		player('RB', 3, 3),
		player('WR', 4, 4),
		player('WR', 5, 5),
		player('WR', 6, 6),
		player('TE', 7, 7),
		player('TE', null, 8)
	];
	const got = startersRight(players, lineup, 'ours');
	assert.deepEqual(got, { right: 6, of: 7 });
});

void test('an order with no stance on a player never calls him, and a position line has no flex', () => {
	const lineup = lineupFor(ESPN_LINEUP, 'WR');
	assert.equal(lineup.flex, 0);
	const players = [player('WR', null, 1), player('WR', 1, 2)];
	assert.deepEqual(startersRight(players, { ...lineup, teams: 1, wr: 1 }, 'ours'), {
		right: 0,
		of: 1
	});
});
