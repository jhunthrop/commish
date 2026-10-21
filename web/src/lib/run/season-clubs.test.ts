// A page whose club is not the one his lines were for (Lane 120, B100). A week with no line of a
// player who changed clubs before his newest line names no opponent (the run cannot say whose he was),
// and the page's `lastGameClub` names a club other than his own and a week he played. The page and the
// slate are the in-season contract fixture's (research/nightly/contract/fixture). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lastGameClubWords } from '../player/club-words.ts';
import { checkRunSeasons } from './season-checks.ts';
import {
	pointsPerGameOf,
	pointsTotalOf,
	seasonSchema,
	STAT_FIELDS,
	type GameLogRow,
	type PlayerSeason
} from './season.ts';
import { playerSchema, scheduleSchema } from './schema.ts';

const RUN = new URL(
	'../../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/',
	import.meta.url
);
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, RUN), 'utf8'));
// Jahmyr Gibbs: DET through week 5, every week 1 to 5 played.
const page = read('players/4429795.json') as {
	id: string;
	team: string;
	season: PlayerSeason;
};
const schedule = scheduleSchema.parse(read('schedule.json'));
/** A week with no line of a player who changed clubs before his newest one: no stat, no opponent. */
const unknown: Partial<GameLogRow> = {
	...Object.fromEntries(STAT_FIELDS.map((field) => [field, null])),
	snapShare: null,
	points: null,
	status: 'inactive',
	opponent: null,
	home: null
};

/** His season with some weeks rewritten, its totals and points a game the played weeks'. */
function withRows(rows: Readonly<Record<number, Partial<GameLogRow>>>): unknown {
	const log = page.season.log.map((row) => ({ ...row, ...rows[row.week] }));
	const played = log.filter((row) => row.status === 'played');
	const sum = (field: keyof GameLogRow): number | null =>
		played.some((row) => row[field] === null)
			? null
			: played.reduce((total, row) => total + Number(row[field]), 0);
	const totals = Object.fromEntries(
		Object.keys(page.season.totals).map((field) => [field, sum(field as keyof GameLogRow)])
	);
	const shares = played.map((row) => row.snapShare);
	// A mean of the played weeks' shares sits between their least and most, as the parse holds it.
	const snapShare = shares.includes(null)
		? null
		: shares.reduce<number>((t, s) => t + (s ?? 0), 0) / shares.length;
	return {
		...page.season,
		log,
		games: played.length,
		pointsPerGame: pointsPerGameOf(played.map((row) => Number(row.points))),
		totals: { ...totals, points: pointsTotalOf(played.map((row) => Number(row.points))), snapShare }
	};
}

function refusal(
	season: unknown,
	lastGameClub?: { club: string; week: number } | null
): string | null {
	const parsed = seasonSchema.safeParse(season);
	if (!parsed.success) return parsed.error.issues.map((issue) => issue.message).join(' ');
	try {
		checkRunSeasons(
			[{ id: page.id, team: page.team, season: parsed.data, lastGameClub }],
			schedule
		);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

void test('an inactive week naming no opponent is read', () => {
	assert.equal(refusal(page.season), null);
	const season = withRows({ 1: unknown, 2: unknown });
	assert.equal(refusal(season), null, JSON.stringify(seasonSchema.safeParse(season).error?.issues));
});

void test('a played or upcoming week naming no opponent is refused, and so is a bye naming one', () => {
	assert.match(
		refusal(withRows({ 3: { opponent: null, home: null } })) ?? '',
		/Week 3 is played but names no opponent\./
	);
	assert.match(
		refusal(withRows({ 7: { opponent: null, home: null } })) ?? '',
		/Week 7 is upcoming but names no opponent\./
	);
	assert.match(
		refusal(withRows({ 6: { opponent: 'KC', home: false } })) ?? '',
		/Week 6 is a bye but names an opponent\./
	);
	assert.match(
		refusal(withRows({ 3: { home: null } })) ?? '',
		/Week 3 names an opponent but not where/
	);
});

void test('the last game club names another club and a week he played', () => {
	assert.equal(refusal(page.season, { club: 'LAC', week: 5 }), null);
	assert.equal(refusal(page.season, null), null);
	assert.equal(
		refusal(page.season, { club: 'DET', week: 5 }),
		`players/${page.id}.json says his week 5 line was for DET, but that is his club.`
	);
	assert.equal(
		refusal(page.season, { club: 'LAC', week: 7 }),
		`players/${page.id}.json says his week 7 line was for LAC, but his log has no game that week.`
	);
});

void test('a run from before the field parses, and the field reads', () => {
	const base = read('players/4429795.json') as Record<string, unknown>;
	assert.equal(playerSchema.parse(base).lastGameClub, undefined);
	const moved = playerSchema.parse({ ...base, lastGameClub: { club: 'LAC', week: 5 } });
	assert.deepEqual(moved.lastGameClub, { club: 'LAC', week: 5 });
});

void test('the page says where he is now and whose his last game was', () => {
	assert.equal(
		lastGameClubWords({ nickname: 'Dolphins' }, 5, { nickname: 'Chargers' }),
		'Now with the Dolphins. His week 5 game was for the Chargers.'
	);
});
