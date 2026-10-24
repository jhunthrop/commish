// Every page's description sentence (Lane 169, ruling 1): built from the page's facts, one sentence,
// no banned word or mark, no provider name, the rankings page's in the brief's words. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import {
	HEAD_WORDS,
	LEAGUE_FREE,
	WORKER_HEADS,
	type BoardFacts,
	type PlayerFacts
} from './head-words.ts';
import { LLMS_ABOUT } from './crawl.ts';

const PUKA: PlayerFacts = {
	name: 'Puka Nacua',
	position: 'WR',
	club: 'Los Angeles Rams',
	positionRank: 3,
	season: 2026,
	label: 'PPR',
	rest: true,
	game: { kind: 'game', week: 8, home: false, opponent: 'San Francisco 49ers' }
};
const BOARD: BoardFacts = { season: 2026, label: 'PPR', teams: 12, rest: true };
const PRESEASON: BoardFacts = { ...BOARD, rest: false };

/** Every sentence the table builds, across the shapes each takes. */
function everySentence(): string[] {
	return [
		HEAD_WORDS.front(2026, 'PPR'),
		HEAD_WORDS.rankings(2026, 8),
		HEAD_WORDS.players(2026, 'PPR'),
		HEAD_WORDS.player(PUKA),
		HEAD_WORDS.player({ ...PUKA, game: { kind: 'bye', week: 8 } }),
		HEAD_WORDS.player({ ...PUKA, club: null, game: null }),
		HEAD_WORDS.player({ ...PUKA, positionRank: null, rest: false }),
		HEAD_WORDS.recordWeekly(2026, 'PPR', 'Our weekly rankings against ADP', 'Our draft board'),
		HEAD_WORDS.recordDraft(2026, 'How the order we set called its games'),
		HEAD_WORDS.board(BOARD, ['QB', 'RB', 'WR', 'TE']),
		HEAD_WORDS.board(PRESEASON, ['QB', 'RB', 'WR', 'TE']),
		HEAD_WORDS.boardPosition(BOARD, 'WR', true),
		HEAD_WORDS.boardPosition(BOARD, 'K', true),
		HEAD_WORDS.boardPosition(PRESEASON, 'DST', false),
		HEAD_WORDS.adp(BOARD, true),
		HEAD_WORDS.adp(PRESEASON, false),
		HEAD_WORDS.clubs(BOARD),
		HEAD_WORDS.club('Los Angeles Rams', BOARD),
		HEAD_WORDS.schedule(2026),
		HEAD_WORDS.llmsPlayers,
		HEAD_WORDS.sheet,
		HEAD_WORDS.print,
		HEAD_WORDS.account,
		HEAD_WORDS.compare,
		HEAD_WORDS.offline,
		LLMS_ABOUT,
		LEAGUE_FREE,
		...Object.values(WORKER_HEADS).flatMap((head) => [head.title, head.description])
	];
}

void test("the rankings page's sentence is the brief's, its week from the run", () => {
	assert.equal(
		HEAD_WORDS.rankings(2026, 8),
		"Our 2026 rest-of-season order for every QB, RB, WR and TE, with each player's week 8 game and the week's published projection."
	);
});

void test("a player's sentence names him, his club, his position, our rank and his week's game", () => {
	assert.equal(
		HEAD_WORDS.player(PUKA),
		'Puka Nacua, Los Angeles Rams WR: WR3 in our 2026 rest-of-season order, week 8 at the San Francisco 49ers.'
	);
	assert.equal(
		HEAD_WORDS.player({ ...PUKA, game: { ...PUKA.game, home: true } as PlayerFacts['game'] }),
		'Puka Nacua, Los Angeles Rams WR: WR3 in our 2026 rest-of-season order, week 8 against the San Francisco 49ers.'
	);
	assert.match(
		HEAD_WORDS.player({ ...PUKA, game: { kind: 'bye', week: 8 } }),
		/on bye in week 8\.$/
	);
	assert.match(HEAD_WORDS.player({ ...PUKA, rest: false }), /WR3 in our 2026 PPR order/);
});

void test('a free agent has no club, and a player on a season-long list no rank', () => {
	assert.equal(
		HEAD_WORDS.player({ ...PUKA, club: null, game: null }),
		'Puka Nacua, a free agent WR: WR3 in our 2026 rest-of-season order.'
	);
	assert.match(
		HEAD_WORDS.player({ ...PUKA, positionRank: null }),
		/unranked in our 2026 rest-of-season order while on a season-long list/
	);
});

void test('every sentence is one sentence, free of the banned words and marks', () => {
	for (const sentence of everySentence()) {
		assert.equal(bannedIn(sentence), null, sentence);
		assert.doesNotMatch(sentence, /\bhosts?\b/i, sentence);
		assert.ok(sentence.trim() === sentence && sentence.length > 0, sentence);
	}
	for (const head of Object.values(WORKER_HEADS)) {
		assert.match(head.description, /^[^.]+\.$/, head.description);
	}
});

void test('no sentence names the projection by its provider, only as the published projection', () => {
	for (const sentence of everySentence()) {
		const projection = sentence.match(/\b\w+ projection\b/g) ?? [];
		for (const said of projection) assert.equal(said, 'published projection', sentence);
	}
});
