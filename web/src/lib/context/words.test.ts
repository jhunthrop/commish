// The context's words: the switch, a league's line, the basis line and the held mark. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shownLeague, switchLabel, type ContextLeague } from './words.ts';
import { heldMark, holderWords } from './held-marks.ts';
import type { Held } from './held-words.ts';
import { contextNote, scoresSentence } from './note-words.ts';
import { safeThen } from './then-path.ts';
import { followingMark, leagueLine } from './menu-words.ts';
import {
	clubsLead,
	hardestFigure,
	hardestWords,
	playedWords,
	scheduleLead,
	winsBasis
} from '#lib/run/strength-words.ts';
import { leagueBasis } from '#lib/league/model.ts';
import { recordHeadline, weekLines } from '#lib/run/record.ts';
import type { RecordWeek } from '#lib/run/schema.ts';

/** The copy guard's doubled word: "the the", "is is". Letters only, so a number pair ("10.5 5 games",
 * "week 1 1 game") never trips it. */
const DOUBLED_WORD = /\b([a-z]+)\s+\1\b/i;

const league = (over: Partial<ContextLeague> = {}): ContextLeague => ({
	id: '3f0c1a52-0000-4000-8000-000000000001',
	name: 'My Ball Zach Ertz',
	host: 'ffpc',
	team_name: 'Ertz Hurts',
	standing: null,
	scoring: 'ppr',
	format: 'ppr',
	settings_league_id: null,
	phase: 'in_season',
	phase_basis: 'FFPC says the draft is done and week 6 is under way.',
	draft_at: null,
	playoff_start_week: 13,
	waivers_open: true,
	...over
});

void test('the switch names the league, else the format, else the default board', () => {
	assert.equal(switchLabel(league(), 'ppr'), 'My Ball Zach Ertz');
	assert.equal(switchLabel(league({ name: '' }), 'ppr'), 'Your FFPC league');
	assert.equal(switchLabel(null, 'half_ppr'), 'Half PPR');
	assert.equal(switchLabel(null, null), 'PPR');
});

void test("a league's line is its host and scoring, and superflex when it reads on that board", () => {
	assert.equal(
		leagueLine(league({ scoring: 'te_premium' })),
		'FFPC, extra points per catch for tight ends'
	);
	assert.equal(
		leagueLine(league({ host: 'sleeper', scoring: 'half_ppr', format: 'superflex' })),
		'Sleeper, half PPR, superflex'
	);
});

void test('a TE premium league on the PPR board says it in plain words, and where exact rules rank it with them', () => {
	const te = league({ scoring: 'te_premium' });
	assert.equal(
		contextNote(te, 'ppr', false)?.text,
		"Your league gives tight ends extra points per catch. This board is PPR, nearest FFPC's rules."
	);
	assert.equal(
		contextNote(te, 'ppr', false, 'These figures are')?.text,
		"Your league gives tight ends extra points per catch. These figures are PPR, nearest FFPC's rules."
	);
	// Nothing says what the exact rules come with (Lane 150).
	assert.equal(contextNote(te, 'ppr', false)?.link, null);
	const saved = '3f0c1a52-0000-4000-8000-000000000009';
	assert.deepEqual(contextNote({ ...te, settings_league_id: saved }, 'ppr', true), {
		text: "Your league gives tight ends extra points per catch. This board is PPR, nearest FFPC's rules.",
		link: { words: "Your league's exact board is in its mock draft.", savedLeague: saved }
	});
	assert.deepEqual(contextNote(te, 'ppr', true), {
		text: "Your league gives tight ends extra points per catch. This board is PPR, nearest FFPC's rules.",
		link: { words: "Set up your league's exact rules to rank by them.", savedLeague: null }
	});
	assert.equal(contextNote(te, 'ppr', false)?.link, null);
	// A Sleeper league's rules are its commissioner's (Lane 94 fix round 2).
	assert.equal(
		contextNote({ ...te, host: 'sleeper' }, 'ppr', true)?.text,
		"Your league gives tight ends extra points per catch. This board is PPR, nearest your league's rules."
	);
});

void test('a format the run does not carry says so and names what the page is in', () => {
	assert.equal(
		contextNote(league({ scoring: 'half_ppr', format: 'half_ppr' }), 'ppr', false)?.text,
		'Your league scores half PPR. We have no half PPR board yet, so this board is PPR.'
	);
});

void test('a link to another board the run carries says what this board is', () => {
	assert.equal(
		contextNote(league(), 'half_ppr', false, 'This board is', true)?.text,
		'Your league scores PPR. This board is half PPR.'
	);
});

void test('a matching league says its scoring, and no league says nothing', () => {
	assert.equal(contextNote(league(), 'ppr', false)?.text, 'Your league scores PPR.');
	assert.equal(
		contextNote(league({ format: 'superflex' }), 'superflex', false)?.text,
		'Your league scores PPR and starts a superflex.'
	);
	assert.equal(contextNote(null, 'ppr', false), null);
});

void test('a row marks your own players by your team and the free agents, never the taken', () => {
	const held: Held = {
		me: 4,
		teams: { 4: 'Ertz Hurts', 7: 'Gmoneyman', 9: '' },
		by: { a: 4, b: 7, c: 9 }
	};
	assert.deepEqual(heldMark(held, 'a'), { words: 'On Ertz Hurts', kind: 'mine' });
	assert.deepEqual(heldMark({ ...held, teams: { 4: '' } }, 'a'), {
		words: 'On your roster',
		kind: 'mine'
	});
	assert.equal(heldMark(held, 'b'), null);
	assert.deepEqual(heldMark(held, 'free'), { words: 'Free agent in your league', kind: 'free' });
});

void test('his page names whose roster he is on, or that he is a free agent', () => {
	const held: Held = {
		me: 4,
		teams: { 4: 'Ertz Hurts', 7: 'Gmoneyman', 9: '' },
		by: { a: 4, b: 7, c: 9 }
	};
	assert.equal(holderWords(held, 'a'), 'On your roster');
	assert.equal(holderWords(held, 'b'), 'Rostered by Gmoneyman');
	assert.equal(holderWords(held, 'c'), 'On a roster in your league');
	assert.equal(holderWords(held, 'free'), 'Free agent in your league');
});

void test("copy guard: no composed line doubles a word, the run's own phrases included", () => {
	// The real run's method carries its own article; the pages once added a second ("the the").
	const slate = {
		method: "the average of each club's opponents' expected wins for the season, one per game",
		window: { from: '2026-09-07T12:00:00.000Z', to: '2026-09-07T12:00:00.000Z' },
		rank: 32
	};
	const view = {
		...slate,
		kind: 'preseason' as const,
		strength: 9.3
	};
	const graded: RecordWeek = {
		week: 1,
		status: 'graded',
		frozenAt: '2026-09-08T12:00:00.000Z',
		frozenBy: '2026-10-14T04',
		order: 'preseason',
		gradedAt: '2026-10-14T04:36:03.983Z',
		population: 341,
		lines: [],
		note: undefined
	};
	const upcoming: RecordWeek = {
		...graded,
		week: 7,
		status: 'upcoming',
		frozenBy: null,
		order: null,
		gradedAt: null,
		frozenAt: '2026-10-23T00:15:00.000Z'
	};
	const score = { graded: 203, agreement: 0.48, placesOff: 43.7, starters: 100, startersOf: 168 };
	const record = {
		season: 2026,
		format: 'ppr-12',
		statistic: { agreement: 'order matched', placesOff: 'places off', starters: 'starters right' },
		scale: "1.00 is a perfect match of the week's finishing order, 0.00 is none.",
		startersBasis: "Starters right counts the week's top 12 QBs that the order also put there.",
		method:
			"Each week our PPR board is frozen before the week's first kickoff and graded after its games.",
		publishedFromWeek: 7,
		honest: null,
		weeks: [graded, missed(3, 'Our order was not set before kickoff that week.'), upcoming],
		toDate: [
			{
				position: 'All' as const,
				ours: score,
				adp: { ...score, agreement: 0.37 },
				published: null,
				oursOnPublished: null,
				espn: null,
				oursOnEspn: null
			}
		]
	};
	const te = league({ scoring: 'te_premium' });
	const held: Held = { me: 1, teams: { 1: 'Nacua Matata', 2: 'Gmoneyman' }, by: { a: 1, b: 2 } };
	const lines = [
		scheduleLead(view, { count: 9, atLeast: '10.5' }, { complete: 5, partial: null }),
		scheduleLead(
			{ ...view, kind: 'rest' },
			{ count: 9, atLeast: '10.5' },
			{ complete: 5, partial: { week: 6, days: ['Thursday'], games: 1 } }
		),
		clubsLead('PPR', view),
		winsBasis('Expected wins, set before the season'),
		hardestFigure(10, 32).caption,
		hardestWords(1, 32),
		hardestWords(32, 32),
		playedWords({ complete: 1, partial: null }),
		playedWords({ complete: 5, partial: { week: 6, days: [], games: 0 } }),
		contextNote(te, 'ppr', false)?.text,
		contextNote(te, 'ppr', true)?.link?.words,
		contextNote({ ...te, settings_league_id: 'x' }, 'ppr', true)?.link?.words,
		contextNote(league({ scoring: 'half_ppr', format: 'half_ppr' }), 'ppr', false)?.text,
		contextNote(league({ format: 'superflex' }), 'superflex', false)?.text,
		leagueLine(league({ host: 'sleeper', scoring: 'half_ppr', format: 'superflex' })),
		leagueLine(te),
		recordHeadline(record).caption,
		...weekLines(record.weeks).map((line) => `${line.lead} ${line.text}`),
		leagueBasis('PPR', 'through week 5', 'te_premium', scoresSentence),
		leagueBasis('Half PPR', '', 'half_ppr', scoresSentence),
		heldMark(held, 'a')?.words,
		heldMark(held, 'free')?.words,
		holderWords(held, 'b')
	];
	for (const line of lines) {
		assert.ok(line, 'every composed line is said');
		assert.doesNotMatch(line, DOUBLED_WORD, line);
	}
	assert.match('Strength is the the average', DOUBLED_WORD);
	assert.doesNotMatch('10.5 5 games, week 1 1 game', DOUBLED_WORD);
});

const missed = (week: number, note: string): RecordWeek => ({
	week,
	status: 'missed',
	frozenAt: null,
	frozenBy: null,
	order: null,
	gradedAt: null,
	population: 0,
	lines: [],
	note
});

void test('missed weeks share a line only while their reason agrees, and the line says why', () => {
	const unset = 'Our order was not set before kickoff that week.';
	const weeks = [
		missed(3, unset),
		missed(4, unset),
		missed(5, 'Our nightly run failed that week.')
	];
	assert.deepEqual(
		weekLines(weeks).map((line) => `${line.lead}, ${line.text}`),
		[
			'Weeks 3 to 4, our order was not set before kickoff, so they cannot be graded',
			'Week 5, our nightly run failed, so it cannot be graded'
		]
	);
});

void test('the account page goes on only to a path on this site', () => {
	const origin = 'https://trycommish.app';
	assert.equal(safeThen('/board?x=1#top', origin), '/board?x=1#top');
	assert.equal(safeThen('/\t/evil.example', origin), null);
	assert.equal(safeThen('//evil.example', origin), null);
	assert.equal(safeThen('https://evil.example/board', origin), null);
	assert.equal(safeThen('javascript:alert(1)', origin), null);
	assert.equal(safeThen('/.//evil.example', origin), null);
	assert.equal(safeThen('/..//evil.example', origin), null);
	assert.equal(safeThen('/a/..//evil.example', origin), null);
	assert.equal(safeThen(' //evil.example', origin), null);
	assert.equal(safeThen('\n//evil.example', origin), null);
	assert.equal(safeThen(null, origin), null);
});

void test("a set week says it is not played yet until its first kickoff, then grades once every game's stats are in", () => {
	const frozen: RecordWeek = {
		week: 6,
		status: 'frozen',
		frozenAt: '2026-10-13T12:00:17.450Z',
		frozenBy: '2026-10-14T04',
		order: 'preseason',
		gradedAt: null,
		population: 0,
		lines: []
	};
	assert.equal(weekLines([frozen], [6])[0]?.text, 'set Tue Oct 13, not played yet');
	assert.equal(
		weekLines([frozen])[0]?.text,
		"set Tue Oct 13, grades once every game's stats are in"
	);
});

void test("the switch names the page's league, the selected one marked in its list (Lane 115, B89)", () => {
	const selected = league();
	const other = league({ id: '3f0c1a52-0000-4000-8000-000000000002', name: 'Office Pool' });
	const leagues = [selected, other];
	// On the other league's page the switch names it; the selection is untouched (B38).
	assert.equal(shownLeague(other.id, leagues, selected), other);
	assert.equal(switchLabel(shownLeague(other.id, leagues, selected), null), 'Office Pool');
	// Off a league's page, or on one the account does not follow, the selected league.
	assert.equal(shownLeague(undefined, leagues, selected), selected);
	assert.equal(shownLeague('unknown', leagues, selected), selected);
	// "following" marks the selected league only where the switch names another.
	assert.equal(followingMark(selected.id, selected.id, other.id), true);
	assert.equal(followingMark(other.id, selected.id, other.id), false);
	assert.equal(followingMark(selected.id, selected.id, selected.id), false);
});
