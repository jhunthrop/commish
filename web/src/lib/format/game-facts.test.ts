// A game's facts as the screens say them (Lane 66a), and the copy guard over every line: run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	type GameConditions,
	clubGame,
	figuresWords,
	gameFactsLine,
	readWords,
	weatherWords
} from './game-facts.ts';

const ZONE = 'America/Chicago';
const READ = '2026-10-25T14:05:00.000Z';

const WEATHER: NonNullable<GameConditions['weather']> = {
	temperature_f: 51.6,
	wind_mph: 14.1,
	precipitation_chance: 0,
	precipitation_kind: 'none',
	read_at: READ
};

const conditions = (over: Partial<GameConditions> = {}): GameConditions => ({
	game_total: { points: 47.5, read_at: READ },
	spread: { side: 'favoured', points: 3, read_at: READ },
	roof: { kind: 'outdoors', abroad: false },
	weather: WEATHER,
	...over
});

void test("the figures say the game's expected score and the margin from his club's side", () => {
	assert.equal(figuresWords(conditions()), 'Expected to win by 3, 47.5 points in the game.');
	assert.equal(
		figuresWords(conditions({ spread: { side: 'underdog', points: 6.5, read_at: READ } })),
		'Expected to lose by 6.5, 47.5 points in the game.'
	);
	assert.equal(
		figuresWords(conditions({ spread: { side: 'even', points: 0, read_at: READ } })),
		'Expected to be even, 47.5 points in the game.'
	);
	assert.equal(figuresWords(conditions({ spread: null })), '47.5 points expected in the game.');
	assert.equal(figuresWords(conditions({ game_total: null, spread: null })), null);
});

void test('the weather says the kickoff hour and where it is played, a dome and a game abroad apart', () => {
	assert.equal(weatherWords(conditions()), '52°F and 14 mph wind at kickoff, outdoors.');
	const wet = conditions({
		roof: { kind: 'retractable', abroad: false },
		weather: {
			temperature_f: 33,
			wind_mph: 9,
			precipitation_chance: 60,
			precipitation_kind: 'snow',
			read_at: READ
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

void test('the read time is the older of the two reads, on the member clock', () => {
	const older = conditions({
		weather: { ...WEATHER, read_at: '2026-10-25T13:05:00.000Z' }
	});
	assert.equal(readWords(older, ZONE), 'Read Sun 8:05 am.');
	assert.equal(readWords(conditions({ game_total: null, weather: null }), ZONE), null);
});

void test('the whole line, as a row says it', () => {
	assert.equal(
		gameFactsLine(conditions(), ZONE),
		'Expected to win by 3, 47.5 points in the game. 52°F and 14 mph wind at kickoff, outdoors. Read Sun 9:05 am.'
	);
	assert.equal(
		gameFactsLine(conditions({ roof: { kind: 'dome', abroad: false }, weather: null }), ZONE),
		'Expected to win by 3, 47.5 points in the game. Indoors. Read Sun 9:05 am.'
	);
	assert.equal(
		gameFactsLine({ game_total: null, spread: null, roof: null, weather: null }, ZONE),
		null
	);
});

void test("a week's answer finds his club's game", () => {
	const game = {
		team: 'SEA',
		opponent: 'KC',
		home: true,
		kickoff: READ,
		played: false,
		...conditions()
	};
	assert.equal(clubGame({ season: 2026, week: 7, games: [game] }, 'SEA'), game);
	assert.equal(clubGame({ season: 2026, week: 7, games: [game] }, 'KC'), null);
});

/** Words the game facts never use: the lines are an input and a fact, named only as the game's
 * expected score and a club favoured or an underdog (Lane 66a). */
const BETTING =
	/\b(favou?red|underdogs?|odds|lines?|spreads?|totals?|bets?|betting|vegas|sportsbooks?|books?|props?|moneyline|market)\b|over\/under/i;

void test('copy guard: no game facts line uses a betting word, a dash, a semicolon or a doubled word', () => {
	const said = [
		gameFactsLine(conditions(), ZONE),
		gameFactsLine(conditions({ spread: { side: 'even', points: 0, read_at: READ } }), ZONE),
		gameFactsLine(conditions({ spread: { side: 'underdog', points: 3.5, read_at: READ } }), ZONE),
		gameFactsLine(conditions({ roof: { kind: 'outdoors', abroad: true }, weather: null }), ZONE),
		gameFactsLine(
			conditions({
				roof: { kind: 'retractable', abroad: false },
				weather: { ...WEATHER, precipitation_chance: 40, precipitation_kind: 'ice' }
			}),
			ZONE
		)
	];
	for (const text of said) {
		assert.ok(text);
		assert.doesNotMatch(text, BETTING, text);
		assert.doesNotMatch(text, /[–—;]/, text);
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
