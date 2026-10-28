// The lineup move made on the host from our screen: the move the screen sends, when the verb sets
// it, the panel's steps and its words. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '#lib/api/client.ts';
import type { HostMovePlan, HostMoveResult, LineupSlot, WaiverRow } from './api.ts';
import {
	addKey,
	bidLabel,
	claimable,
	bidProblem,
	claimMove,
	claimsOnHost,
	failedStep,
	moveTitle,
	resultWords,
	lostWords,
	MOVE_LINES,
	hostSaid,
	lineupMove,
	openHostWords,
	planStep,
	readingWords,
	resultStep,
	setsOnHost,
	settingWords
} from './move.ts';

const player = (id: string, name: string): LineupSlot['ours'] => ({
	player: { host_id: id, board_id: null, name, position: 'RB', team: 'TB', injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: null,
	points_over_replacement: null,
	rest_of_season_per_game: null,
	week_projection: null,
	projection_delta: null,
	opp_rank: null,
	season_avg: null,
	last_points: null,
	held: false,
	facts: {
		week: 7,
		opponent: 'BUF',
		home: false,
		kickoff: '2026-10-18T17:00:00.000Z',
		bye: false,
		designation: null,
		played: false,
		points_this_week: null,
		last_games: [],
		allowed_to_position: null,
		game_total: null,
		spread: null,
		roof: null,
		weather: null
	}
});

const slots: LineupSlot[] = [
	{
		slot: 'QB',
		ours: player('1', 'Patrick Mahomes'),
		host: player('1', 'Patrick Mahomes'),
		changed: false,
		no_one_can_play: false,
		sentence: null
	},
	{
		slot: 'RB',
		ours: player('2', 'Rachaad White'),
		host: player('3', 'Tank Bigsby'),
		changed: true,
		no_one_can_play: false,
		sentence: 'Bigsby is out.'
	},
	{
		slot: 'FLEX',
		ours: player('4', 'Jauan Jennings'),
		host: null,
		changed: true,
		no_one_can_play: false,
		sentence: 'An empty spot.'
	}
];

void test('the move is each changed slot: the player in and the starter out, for the week read', () => {
	assert.deepEqual(lineupMove({ week: 7, slots }), {
		kind: 'lineup',
		week: 7,
		changes: [
			{ slot: 'RB', in: '2', out: '3' },
			{ slot: 'FLEX', in: '4', out: null }
		]
	});
});

void test('the verb sets the lineup on the host only when the API opens the move and there is a change', () => {
	const open = {
		lineup: 'available' as const,
		note: null,
		takes_writes: true,
		writes_on: true,
		reason: null
	};
	const closed = {
		lineup: 'unavailable' as const,
		note: null,
		takes_writes: false,
		writes_on: false,
		reason: 'Sleeper does not take lineups from here, so copy the lineup there.'
	};
	assert.equal(setsOnHost({ set: false, slots, moves: open }), true);
	assert.equal(setsOnHost({ set: false, slots, moves: closed }), false);
	assert.equal(setsOnHost({ set: true, slots: [], moves: open }), false);
	assert.equal(setsOnHost({ set: false, slots: slots.slice(0, 1), moves: open }), false);
});

const ready: HostMovePlan = {
	status: 'ready',
	sentence:
		'Start Rachaad White over Tank Bigsby at RB, and Jauan Jennings in the flex, on ESPN now.',
	confirm: 'token',
	expires_at: '2026-10-18T15:10:00Z',
	host_url: 'https://fantasy.espn.com/football/team?leagueId=1&teamId=3',
	bid: null
};

void test('a ready plan is the move to confirm, any other is the host page with the API sentence', () => {
	assert.deepEqual(planStep(ready), { kind: 'confirm', plan: { ...ready, confirm: 'token' } });
	assert.deepEqual(
		planStep({
			...ready,
			status: 'unavailable',
			confirm: null,
			sentence: 'Make this change on ESPN.'
		}),
		{ kind: 'unavailable', sentence: 'Make this change on ESPN.', href: ready.host_url }
	);
	assert.equal(planStep({ ...ready, confirm: null }).kind, 'unavailable');
});

void test('an answer is what the move came to, an unavailable one is the host page', () => {
	const refused: HostMoveResult = {
		outcome: 'refused',
		sentence: 'ESPN did not make the move, so nothing changed there.',
		host_words: 'Lineup transaction could not be completed, Alexander Mattison is locked',
		host_url: ready.host_url,
		move_id: '6f1d1c52-2626-4a26-9a26-000000000035',
		processes_at: null
	};
	assert.deepEqual(resultStep(refused), { kind: 'answered', result: refused });
	assert.deepEqual(
		resultStep({ ...refused, outcome: 'unavailable', host_words: null, move_id: null }),
		{
			kind: 'unavailable',
			sentence: refused.sentence,
			href: ready.host_url
		}
	);
});

void test("the host's reason is said in its own words under ours, ended once", () => {
	assert.equal(
		hostSaid('espn', 'Lineup transaction could not be completed, Alexander Mattison is locked'),
		'ESPN said: Lineup transaction could not be completed, Alexander Mattison is locked.'
	);
	assert.equal(
		hostSaid('espn', ' Transaction type can only be executed in the current scoring period. '),
		'ESPN said: Transaction type can only be executed in the current scoring period.'
	);
	assert.equal(settingWords('espn'), 'Setting it on ESPN');
	assert.equal(openHostWords('espn'), 'Open ESPN');
	assert.equal(readingWords('espn'), 'Reading your lineup on ESPN');
	assert.equal(MOVE_LINES.notNow, 'Not now');
});

void test('a failed call says the API sentence, never a raw error, and a lost move sends the member to the host', () => {
	const href = 'https://fantasy.espn.com/football/team?leagueId=1&teamId=3';
	const expired = new ApiError(400, {
		code: 'invalid',
		message: 'That confirmation expired. Review the move again.',
		fields: { confirm: 'That confirmation expired. Review the move again.' }
	});
	assert.deepEqual(failedStep(expired, 'espn', 'make', href), {
		kind: 'failed',
		sentence: 'That confirmation expired. Review the move again.',
		href: null
	});
	const fieldOnly = new ApiError(400, {
		code: 'invalid',
		message: 'Some of that did not check out',
		fields: { confirm: 'That confirmation is for another move. Review the move again.' }
	});
	assert.equal(
		(failedStep(fieldOnly, 'espn', 'make', href) as { sentence: string }).sentence,
		'That confirmation is for another move. Review the move again.'
	);
	const stale = new ApiError(422, {
		code: 'invalid',
		message: 'ESPN is on week 8 now. Reload your lineup to see it.'
	});
	assert.equal(
		(failedStep(stale, 'espn', 'plan', href) as { sentence: string }).sentence,
		'ESPN is on week 8 now. Reload your lineup to see it.'
	);
	const offline = new ApiError(0, { code: 'offline', message: 'We could not reach Commish' });
	assert.deepEqual(failedStep(offline, 'espn', 'make', href), {
		kind: 'failed',
		sentence: lostWords('espn'),
		href,
		lost: true
	});
	assert.deepEqual(failedStep(new TypeError('Failed to fetch'), 'espn', 'make', href), {
		kind: 'failed',
		sentence: lostWords('espn'),
		href,
		lost: true
	});
	const planDrop = failedStep(new TypeError('Failed to fetch'), 'espn', 'plan', href);
	assert.ok(
		planDrop.kind === 'failed' && !planDrop.sentence.includes('TypeError') && planDrop.href === null
	);
	assert.equal(
		lostWords('espn'),
		'We did not hear back, so the move may have been made. Check your lineup on ESPN before you set it again.'
	);
});

const waiverRow: WaiverRow = {
	add: player('15818', 'Keenan Allen'),
	drop: player('11674', 'Danny Amendola'),
	gain: 1.2,
	starts: true,
	week_gain: 0,
	pickup: false,
	beats: null,
	drops: [],
	clears: null,
	sentence: 'Allen starts for you.'
};

void test("a claim is the row's add and drop with the bid typed, for the week read, and no lineup changes", () => {
	assert.deepEqual(claimMove(7, waiverRow, 12), {
		kind: 'claim',
		week: 7,
		changes: [],
		claim: { add: '15818', drop: '11674', bid: 12 }
	});
	assert.deepEqual(claimMove(7, { ...waiverRow, drop: null }, null).claim, {
		add: '15818',
		drop: null,
		bid: null
	});
	assert.equal(
		claimsOnHost({
			moves: { claim: 'available', note: null, takes_writes: false, writes_on: false, reason: null }
		}),
		true
	);
	assert.equal(
		claimsOnHost({
			moves: {
				claim: 'unavailable',
				note: null,
				takes_writes: false,
				writes_on: false,
				reason: null
			}
		}),
		false
	);
});

void test("the bid field names its basis, and a bid outside the league's bounds says them", () => {
	const bid = { amount: 0, min: 0, max: 500, left_known: true };
	assert.equal(bidLabel(bid), 'Your bid in waiver dollars, $0 to $500, what your team has left');
	// When ESPN did not say what was spent, the bound is the league's budget, said as such.
	assert.equal(
		bidLabel({ ...bid, left_known: false }),
		"Your bid in waiver dollars, $0 to $500, the league's budget"
	);
	assert.equal(bidProblem('espn', '12', bid), null);
	assert.equal(bidProblem('espn', '0', bid), null);
	for (const typed of ['501', '-1', '1.5', '', 'twelve']) {
		assert.equal(
			bidProblem('espn', typed, bid),
			'ESPN takes bids from $0 to $500 in this league.',
			typed
		);
	}
});

void test("a claim's words: the panel, its verb on the way, and a queued claim on the member's clock", () => {
	assert.equal(moveTitle('claim'), 'Your claim');
	assert.equal(moveTitle('lineup'), 'Your lineup move');
	assert.equal(settingWords('espn', 'claim'), 'Claiming on ESPN');
	assert.equal(readingWords('espn', 'claim'), 'Reading your roster on ESPN');
	assert.equal(
		lostWords('espn', 'claim'),
		'We did not hear back, so the claim may have been made. Check your claims on ESPN before you claim again.'
	);
	const pending: HostMoveResult = {
		outcome: 'pending',
		sentence:
			'Claim submitted. ESPN processes claims on Wednesday, and your lineup screen will show him once it goes through.',
		host_words: null,
		host_url: ready.host_url,
		move_id: null,
		processes_at: '2026-10-16T07:00:00.000Z'
	};
	assert.equal(
		resultWords('espn', pending, 'America/New_York'),
		'Claim submitted. ESPN processes it Fri 3:00 am, and your lineup screen will show him once it goes through.'
	);
	assert.equal(resultWords('espn', { ...pending, processes_at: null }), pending.sentence);
	assert.equal(resultWords('espn', { ...pending, outcome: 'done' }), pending.sentence);
});

void test('a claim opens only for an add the host names: an add with no host id keeps the host link', () => {
	assert.equal(claimable(waiverRow), true);
	const unnamed: WaiverRow = {
		...waiverRow,
		add: { ...waiverRow.add, player: { ...waiverRow.add.player, host_id: '', board_id: '4686422' } }
	};
	assert.equal(claimable(unnamed), false);
	assert.equal(
		claimable({
			...unnamed,
			add: { ...unnamed.add, player: { ...unnamed.add.player, host_id: 'board-1' } }
		}),
		false
	);
	assert.equal(
		claimable({
			...unnamed,
			add: { ...unnamed.add, player: { ...unnamed.add.player, host_id: '-16010' } }
		}),
		true
	);
	// A row is marked by its own key, so two adds with no host id are two rows.
	assert.equal(addKey(unnamed), 'board:4686422');
	assert.equal(addKey(waiverRow), '15818');
});
