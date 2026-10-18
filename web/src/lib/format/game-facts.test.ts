// A game's facts as the screens say them (Lane 66a), and the copy guard over every line: run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	type GameConditions,
	figuresWords,
	gameFactsLine,
	readWords,
	toBePlayed,
	weatherWords
} from './game-facts.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-25T14:05:00.000Z';
const KICKOFF = '2026-10-25T17:00:00.000Z';

const WEATHER: NonNullable<GameConditions['weather']> = {
	temperature_f: 51.6,
	wind_mph: 14.1,
	precipitation_chance: 0,
	precipitation_kind: 'none',
	read_at: READ
};

const conditions = (over: Partial<GameConditions> = {}): GameConditions => ({
	game_total: { points: 47.5, team_points: 25, read_at: READ },
	spread: { side: 'win', points: 3, read_at: READ },
	roof: { kind: 'outdoors', abroad: false },
	weather: WEATHER,
	...over
});

void test("the figures say his club's points and the margin from its side, then the game's points", () => {
	assert.equal(
		figuresWords(conditions()),
		'Expected to score 25 and to win by 3, 47.5 points in the game.'
	);
	assert.equal(
		figuresWords(
			conditions({
				game_total: { points: 47.5, team_points: 20.5, read_at: READ },
				spread: { side: 'lose', points: 6.5, read_at: READ }
			})
		),
		'Expected to score 20.5 and to lose by 6.5, 47.5 points in the game.'
	);
	assert.equal(
		figuresWords(conditions({ spread: { side: 'even', points: 0, read_at: READ } })),
		'Expected to be a close game, 47.5 points in the game.'
	);
	assert.equal(figuresWords(conditions({ spread: null })), '47.5 points expected in the game.');
	assert.equal(figuresWords(conditions({ game_total: null, spread: null })), null);
});

void test('the weather says the kickoff hour and where it is played, a dome and a game abroad apart', () => {
	assert.equal(weatherWords(conditions()), '52°F and 14 mph wind at kickoff, outdoors.');
	const wet = conditions({
		roof: { kind: 'retractable', abroad: false },
		weather: {
			...WEATHER,
			temperature_f: 33,
			wind_mph: 9,
			precipitation_chance: 60,
			precipitation_kind: 'snow'
		}
	});
	assert.equal(
		weatherWords(wet),
		'33°F, 9 mph wind and a 60% chance of snow at kickoff, under a retractable roof.'
	);
	assert.equal(weatherWords(conditions({ roof: { kind: 'dome', abroad: false } })), 'Indoors.');
	assert.equal(
		weatherWords(conditions({ roof: { kind: 'outdoors', abroad: true }, weather: null })),
		'Played abroad, so no forecast.'
	);
	assert.equal(weatherWords(conditions({ weather: null })), 'Outdoors.');
	assert.equal(weatherWords(conditions({ roof: null, weather: null })), null);
});

void test('a chance the forecast gives no kind is precipitation, never a kind it did not name', () => {
	for (const kind of ['none', null] as const) {
		const said = weatherWords(
			conditions({ weather: { ...WEATHER, precipitation_chance: 20, precipitation_kind: kind } })
		);
		assert.equal(said, '52°F, 14 mph wind and a 20% chance of precipitation at kickoff, outdoors.');
	}
	assert.equal(
		weatherWords(
			conditions({ weather: { ...WEATHER, precipitation_chance: 19, precipitation_kind: 'rain' } })
		),
		'52°F and 14 mph wind at kickoff, outdoors.'
	);
});

void test('the read time is the older of the two reads, on the member clock', () => {
	const older = conditions({ weather: { ...WEATHER, read_at: '2026-10-25T13:05:00.000Z' } });
	assert.equal(readWords(older, ZONE), 'Read Sun 8:05 am.');
	assert.equal(readWords(conditions({ game_total: null, weather: null }), ZONE), null);
});

void test('the whole line, as a row says it', () => {
	assert.equal(
		gameFactsLine(conditions(), ZONE),
		'Expected to score 25 and to win by 3, 47.5 points in the game. 52°F and 14 mph wind at kickoff, outdoors. Read Sun 9:05 am.'
	);
	assert.equal(
		gameFactsLine(conditions({ roof: { kind: 'dome', abroad: false }, weather: null }), ZONE),
		'Expected to score 25 and to win by 3, 47.5 points in the game. Indoors. Read Sun 9:05 am.'
	);
	assert.equal(
		gameFactsLine({ game_total: null, spread: null, roof: null, weather: null }, ZONE),
		null
	);
});

void test('the facts are said only until kickoff', () => {
	const before = Date.parse(KICKOFF) - 1;
	assert.ok(toBePlayed({ played: false, kickoff: KICKOFF }, before));
	assert.ok(!toBePlayed({ played: false, kickoff: KICKOFF }, Date.parse(KICKOFF)));
	assert.ok(!toBePlayed({ played: true, kickoff: KICKOFF }, before));
	assert.ok(toBePlayed({ played: false, kickoff: null }, before));
});

/** Words the game facts never use: the lines are an input and a fact, named only as what his club is
 * expected to score and to win or lose by (the round 4 lock's copy rule, its L5). */
const BETTING = bannedPattern(/\b(books?|props?|moneyline)\b|–/);

void test('copy guard: no game facts line uses a betting word, a dash, a semicolon or a doubled word', () => {
	const said = [
		gameFactsLine(conditions(), ZONE),
		gameFactsLine(conditions({ spread: { side: 'even', points: 0, read_at: READ } }), ZONE),
		gameFactsLine(conditions({ spread: { side: 'lose', points: 3.5, read_at: READ } }), ZONE),
		gameFactsLine(conditions({ roof: { kind: 'outdoors', abroad: true }, weather: null }), ZONE),
		gameFactsLine(
			conditions({
				roof: { kind: 'retractable', abroad: false },
				weather: { ...WEATHER, precipitation_chance: 40, precipitation_kind: 'ice' }
			}),
			ZONE
		),
		gameFactsLine(
			conditions({ weather: { ...WEATHER, precipitation_chance: 30, precipitation_kind: null } }),
			ZONE
		)
	];
	for (const text of said) {
		assert.ok(text);
		assert.doesNotMatch(text, BETTING, text);
		assert.doesNotMatch(text, /\b([a-z]+)\s+\1\b/i, text);
	}
	for (const banned of [
		'favoured by 3',
		'an underdog',
		'the odds',
		'the line',
		'the spread',
		'the over/under',
		'a bet',
		'the total'
	])
		assert.match(banned, BETTING);
});
