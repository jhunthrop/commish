// The League page's fixture (Lane 66i), after build.ts and project.ts:
//   - sync.json gains the League page's fields (league-fields.ts), for a fixture built before them;
//   - scoreboard.json is GET /leagues/attached/{id}/scoreboard's answer at the recorded read: every
//     game of the week with each side's points and its starters' week projections as printed,
//     summed, from the lines the other answers hold for them (a starter no answer lists counts
//     nothing), the game's state from those lines' kickoffs;
//   - scoreboard-live.json is the same week on its Sunday afternoon, a stand-in so a shot shows the
//     board's played states: each side's points so far are its kicked-off starters' share of its
//     projection, and every game whose starters all kicked off before noon Central is final.
//
//   node scripts/inseason-fixture/league.ts
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import { leagueFields } from './league-fields.ts';
import { otherGameLines } from './other-game.ts';
import { linesOf, recordedMatchups, scoreboardAt } from './scoreboard-at.ts';
import { SUNDAY, sundayFinal } from './sunday.ts';

const DATA = new URL('./data/', import.meta.url);
/** The recorded read: Wednesday afternoon of week 6, before any game. */
const READ_AT = '2026-10-14T19:05:38.329Z';

async function json<T>(url: URL): Promise<T> {
	return JSON.parse(await readFile(url, 'utf8')) as T;
}

const [sync, lineup, waivers, trades, box, matchups, fields] = await Promise.all([
	json<LeagueSync>(new URL('sync.json', DATA)),
	json<LineupAdvice>(new URL('lineup.json', DATA)),
	json<WaiverAdvice>(new URL('waivers.json', DATA)),
	json<TradeAdvice>(new URL('trades.json', DATA)),
	json<MatchupBox>(new URL('matchup.json', DATA)),
	recordedMatchups(),
	leagueFields()
]);

const teams = sync.teams.map((team) => ({ ...team, ...fields.team(team.roster_id) }));
const syncMoves = sync.moves.map((m) => ({ ...m, bid: fields.bid(Date.parse(m.at)) }));
const terms = fields.terms;

// ---- the scoreboard (scoreboard-at.ts)

const recordedWeek = {
	me: sync.me,
	week: sync.week,
	matchups,
	lines: linesOf({ lineup, waivers, trades, matchup: box }, await otherGameLines()),
	box
};

const recorded = Date.parse(READ_AT);
const sunday = Date.parse(SUNDAY);

const style = await resolveConfig(fileURLToPath(DATA));
const answers = {
	sync: { ...sync, teams, moves: syncMoves, terms, moves_read: true },
	scoreboard: scoreboardAt(
		recordedWeek,
		{ now: recorded, final: (l) => l.facts.played, scored: false },
		READ_AT
	),
	'scoreboard-live': scoreboardAt(
		recordedWeek,
		{ now: sunday, final: sundayFinal, scored: true },
		SUNDAY
	)
};
await Promise.all(
	Object.entries(answers).map(async ([name, body]) =>
		writeFile(
			new URL(`${name}.json`, DATA),
			await prettierFormat(JSON.stringify(body), { ...style, parser: 'json' })
		)
	)
);
process.stdout.write(
	`League page: ${String(teams.length)} teams, ${String(syncMoves.filter((m) => m.bid !== null).length)} bids, ${String(answers.scoreboard.games.length)} games.\n`
);
