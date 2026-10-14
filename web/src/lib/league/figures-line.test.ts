// The league page's basis line names scorings only, never a lineup shape, and promises nothing: run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoresSentence } from '#lib/context/note-words.ts';
import { leagueBasis as basisOf } from './model.ts';

const leagueBasis = (
	scoring: string,
	through: number,
	like: Parameters<typeof scoresSentence>[0]
): string => basisOf(scoring, through, like, scoresSentence);

void test('a TE premium league on the PPR figures says the figures once and the league in plain words', () => {
	assert.equal(
		leagueBasis('PPR', 5, 'te_premium'),
		"PPR. This season's games and points a game through week 5, beside our preseason proj and over repl. Your league gives tight ends extra points per catch."
	);
});

void test('a league scoring like the figures says nothing more', () => {
	assert.equal(
		leagueBasis('PPR', 5, 'ppr'),
		"PPR. This season's games and points a game through week 5, beside our preseason proj and over repl."
	);
	assert.equal(
		leagueBasis('Half PPR', 0, 'half_ppr'),
		"Half PPR. This season's games and points a game, beside our preseason proj and over repl."
	);
});

void test('the line never names a lineup shape or promises exact rules', () => {
	const line = leagueBasis('PPR', 5, 'standard');
	assert.match(line, /Your league scores standard\.$/);
	assert.doesNotMatch(line, /superflex|Draft Pass|exact rules/i);
});
