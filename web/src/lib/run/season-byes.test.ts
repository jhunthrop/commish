// A season log's bye (Lane 119): at most one, and only on a week his club's slate has no game. A
// player who changed clubs played his club's bye week for the club he was with, so his log has none;
// run 2026-10-21T05 carried five such pages and the old rule ("exactly one") refused the whole run.
// The page and the slate are the in-season contract fixture's (research/nightly/contract/fixture).
// Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkRunSeasons } from './season-checks.ts';
import { seasonSchema, type GameLogRow, type PlayerSeason } from './season.ts';
import { scheduleSchema } from './schema.ts';

const RUN = new URL(
	'../../../../research/nightly/contract/fixture/runs/2026-10-21T12-ros/',
	import.meta.url
);
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, RUN), 'utf8'));
// Jahmyr Gibbs: DET, whose bye is week 6, through week 5.
const page = read('players/4429795.json') as { id: string; team: string; season: PlayerSeason };
const schedule = scheduleSchema.parse(read('schedule.json'));
const CLUB_BYE = 6;
const CLUB_GAME = 7;

/** His log with some weeks rewritten. */
function withRows(rows: Readonly<Record<number, Partial<GameLogRow>>>): unknown {
	const log = page.season.log.map((row) => ({ ...row, ...rows[row.week] }));
	return { ...page.season, log };
}
const away = { status: 'inactive', opponent: 'KC', home: false } as const;
const bye = { status: 'bye', opponent: null, home: null } as const;

function refusal(season: unknown): string | null {
	const parsed = seasonSchema.safeParse(season);
	if (!parsed.success) return parsed.error.issues.map((issue) => issue.message).join(' ');
	try {
		checkRunSeasons([{ id: page.id, team: page.team, season: parsed.data }], schedule);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

void test('the fixture page, one bye on his club bye week, is read', () => {
	assert.equal(refusal(page.season), null);
});

void test('a log with no bye, his club bye week a game for the club he was with, is read', () => {
	assert.equal(refusal(withRows({ [CLUB_BYE]: away })), null);
});

void test('two byes are refused', () => {
	assert.match(
		refusal(withRows({ [CLUB_GAME]: bye })) ?? '',
		/The log has 2 byes, a club has one\./
	);
});

void test('a bye on a week his club plays is refused', () => {
	assert.equal(
		refusal(withRows({ [CLUB_BYE]: away, [CLUB_GAME]: bye })),
		`players/${page.id}.json has a bye in week ${String(CLUB_GAME)}, but ${page.team} plays that week.`
	);
});
