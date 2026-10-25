// Any game of the week on the Matchup (Lane 204): the member's score bug keeps the plain address,
// every other bug names its first side's roster, the page reads it back from its address, and
// another team's game takes its score from the scoreboard. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Component } from 'svelte';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import type { LeagueSync } from '../api.ts';
import type { MatchupBox, Scoreboard } from '../inseason/api.ts';
import { bugsOf, type Bug } from '../home/home.ts';
import { GAME_PARAM, bugRoster, gameHref, gameRoster, isOtherGame, otherGame } from './game.ts';

const DATA = new URL('../../../../scripts/inseason-fixture/data/', import.meta.url);
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(name, DATA), 'utf8'));
const sync = fixture('sync.json') as LeagueSync;
const board = fixture('scoreboard.json') as Scoreboard;
const box = fixture('matchup.json') as MatchupBox;
const MATCHUP = '/league/l1/matchup';
const NOW = Date.parse('2026-10-18T18:56:00.000Z');
const bugs = bugsOf(board, sync, NOW, 'America/New_York');

void test("the member's bug keeps the plain address, every other bug names its first side", () => {
	const [mine, ...others] = bugs;
	assert.ok(mine?.mine === true, "the member's game is not first");
	assert.equal(gameHref(MATCHUP, bugRoster(mine)), MATCHUP);
	assert.ok(others.length > 0);
	for (const bug of others) {
		const first = bug.sides[0]?.rosterId;
		assert.equal(bug.mine, false);
		assert.equal(gameHref(MATCHUP, bugRoster(bug)), `${MATCHUP}?${GAME_PARAM}=${String(first)}`);
	}
});

void test('the address reads back the roster it names, nothing for any other', () => {
	const read = (query: string): number | null => gameRoster(new URLSearchParams(query));
	assert.equal(read('roster=7'), 7);
	assert.equal(read('roster=0'), 0);
	for (const bad of ['', 'roster=', 'roster=two', 'roster=-1', 'roster=1.5', 'roster=1234567890'])
		assert.equal(read(bad), null, bad);
	const bug = bugs[1];
	assert.ok(bug);
	const href = gameHref(MATCHUP, bugRoster(bug));
	assert.equal(gameRoster(new URL(href, 'https://x.test').searchParams), bug.sides[0]?.rosterId);
});

/** The fixture's box as the API draws another roster's game: the member's sides swapped. */
const theirs: MatchupBox = {
	...box,
	viewer_side: 'other',
	standing: null,
	sides: [...box.sides].reverse()
};

void test("another team's game takes its sides' points from the scoreboard, in the box's order", () => {
	const game = otherGame(theirs, board);
	assert.ok(game);
	const [first, second] = theirs.sides;
	assert.equal(game.mine.roster_id, first?.roster_id);
	assert.equal(game.opponent?.roster_id, second?.roster_id);
	const points = (roster: number | undefined): number | undefined =>
		board.games.flatMap((g) => g.sides).find((s) => s.roster_id === roster)?.points;
	assert.equal(game.mine.points, points(first?.roster_id));
	assert.equal(game.opponent?.points, points(second?.roster_id));
	assert.equal(game.mine.player_points, first?.player_points);
	assert.deepEqual(game.mine.starters, []);
});

void test("the member's box, and an API's from before viewer_side, draw the member's game", () => {
	assert.equal(otherGame(box, board), null);
	assert.equal(otherGame({ ...box, viewer_side: 'mine' }, board), null);
	assert.equal(isOtherGame(box), false);
	assert.equal(otherGame(null, board), null);
	assert.equal(otherGame({ ...theirs, sides: [] }, board), null);
});

/** The box of a game the member is not in: the scoreboard's second game, the box's sides relabelled. */
const elsewhere = ((): MatchupBox => {
	const game = board.games.find((g) => g.sides.every((s) => s.roster_id !== sync.me));
	assert.ok(game);
	return {
		...theirs,
		sides: box.sides.map((side, i) => ({ ...side, roster_id: game.sides[i]?.roster_id ?? -1 }))
	};
})();

void test("another team's game with no scoreboard read is the box's own sides, points unread (review 204 M1)", () => {
	for (const unread of [null, { games: [] }]) {
		const game = otherGame(elsewhere, unread);
		assert.ok(game, 'the box that arrived draws nothing');
		assert.deepEqual(
			[game.mine.roster_id, game.opponent?.roster_id],
			elsewhere.sides.map((s) => s.roster_id)
		);
		assert.ok(
			[game.mine, game.opponent].every((s) => s?.points_read === false),
			'a side reads its points as read with no scoreboard'
		);
		// Never the member's game, the sync answer's matchup.
		const sides = [game.mine.roster_id, game.opponent?.roster_id];
		assert.ok(!sides.includes(sync.me), "the member's roster is on another team's game");
		assert.notDeepEqual(game, sync.matchup);
	}
	// With the scoreboard read, the same sides carry its points.
	const read = otherGame(elsewhere, board);
	assert.equal(read?.mine.points_read, true);
});

void test("the Matchup decides another team's game by the box alone, and the scoreboard read fails soft", () => {
	const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');
	const panel = read('../MatchupPanel.svelte');
	assert.match(panel, /const other = \$derived\(isOtherGame\(box\)\)/);
	assert.match(panel, /const matchup = \$derived\(other \? game : sync\.matchup\)/);
	assert.match(
		read('../MatchupScreen.svelte'),
		/async function readBoard\(\)[\s\S]*?catch \{\s*return null;/
	);
});

/** A .svelte file compiled for the server as a data URL, its imports pointed at the files they name
 * and every .svelte import compiled the same way (routes/app/signed-in/page.test.ts). */
function compiled(file: URL): string {
	const { js } = compile(readFileSync(file, 'utf8'), {
		generate: 'server',
		filename: file.pathname
	});
	const code = js.code.replace(/from '([^']+)'/g, (_, spec: string) => {
		const target = spec.startsWith('.') ? new URL(spec, file).href : import.meta.resolve(spec);
		return `from '${target.endsWith('.svelte') ? compiled(new URL(target)) : target}'`;
	});
	return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

void test("the League home's scoreboard links each bug to its own game", async () => {
	const mod = (await import(compiled(new URL('../home/ScoreBoard.svelte', import.meta.url)))) as {
		default: Component<{ week: number; bugs: readonly Bug[]; matchupHref: string }>;
	};
	const html = render(mod.default, {
		props: { week: board.week, bugs, matchupHref: MATCHUP }
	}).body;
	const hrefs = [...html.matchAll(/<a class="bug[^"]*"[^>]*href="([^"]+)"/g)].map((m) =>
		(m[1] ?? '').replaceAll('&amp;', '&')
	);
	assert.equal(hrefs.length, bugs.length);
	assert.equal(hrefs[0], MATCHUP);
	const other = bugs[1];
	assert.ok(other);
	// A non-member bug's link, followed, asks for that bug's own roster.
	const followed = new URL(hrefs[1] ?? '', 'https://x.test');
	assert.equal(followed.pathname, MATCHUP);
	assert.equal(gameRoster(followed.searchParams), other.sides[0]?.rosterId);
	assert.notEqual(other.sides[0]?.rosterId, sync.me);
	assert.equal(new Set(hrefs).size, hrefs.length, 'two bugs open the same game');
});
