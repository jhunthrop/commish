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
	PlayerLine,
	Scoreboard,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import { leagueFields } from './league-fields.ts';

type ScoreboardGame = Scoreboard['games'][number];

const DATA = new URL('./data/', import.meta.url);
const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);
const TENTH = 10;
/** The recorded read: Wednesday afternoon of week 6, before any game. */
const READ_AT = '2026-10-14T19:05:38.329Z';
/** The Sunday stand-in: 1:52 pm Central, the noon games in their fourth quarter. */
const SUNDAY = '2026-10-18T18:52:00.000Z';
/** The share of a kicked-off starter's projection the Sunday stand-in counts as scored. */
const SCORED_SHARE = 0.85;

interface SleeperMatchup {
	roster_id: number;
	matchup_id: number | null;
	starters: string[];
	points: number;
}

async function json<T>(url: URL): Promise<T> {
	return JSON.parse(await readFile(url, 'utf8')) as T;
}

const [sync, lineup, waivers, trades, box, matchups, fields] = await Promise.all([
	json<LeagueSync>(new URL('sync.json', DATA)),
	json<LineupAdvice>(new URL('lineup.json', DATA)),
	json<WaiverAdvice>(new URL('waivers.json', DATA)),
	json<TradeAdvice>(new URL('trades.json', DATA)),
	json<MatchupBox>(new URL('matchup.json', DATA)),
	json<SleeperMatchup[]>(new URL('matchups.json', REPLAY)),
	leagueFields()
]);

const tenth = (n: number): number => Math.round(n * TENTH) / TENTH;

const teams = sync.teams.map((team) => ({ ...team, ...fields.team(team.roster_id) }));
const syncMoves = sync.moves.map((m) => ({ ...m, bid: fields.bid(Date.parse(m.at)) }));
const terms = fields.terms;

// ---- the scoreboard

const lineOf = new Map<string, PlayerLine>();
const remember = (line: PlayerLine | null | undefined): void => {
	if (line) lineOf.set(line.player.host_id, line);
};
trades.teams.forEach((t) => {
	t.roster.forEach(remember);
});
trades.roster.forEach(remember);
waivers.rows.forEach((r) => {
	remember(r.add);
	remember(r.drop);
});
[...lineup.slots.flatMap((s) => [s.ours, s.host]), ...lineup.bench, ...lineup.reserve].forEach(
	remember
);
box.sides.forEach((s) => {
	s.starters.forEach((st) => {
		remember(st.line);
	});
	s.bench.forEach(remember);
});

interface Kicks {
	kicked: number;
	final: number;
	games: number;
	next: string | null;
}

function kicks(lines: readonly PlayerLine[], now: number, finalBy: number): Kicks {
	const out: Kicks = { kicked: 0, final: 0, games: 0, next: null };
	for (const { facts } of lines) {
		if (facts.bye || facts.kickoff === null) continue;
		out.games++;
		const at = Date.parse(facts.kickoff);
		const final = facts.played || at <= finalBy;
		if (final) out.final++;
		if (final || at <= now) {
			out.kicked++;
			continue;
		}
		if (out.next === null || at < Date.parse(out.next)) out.next = facts.kickoff;
	}
	return out;
}

function stateOf(k: Kicks): ScoreboardGame['state'] {
	if (k.kicked === 0) return 'upcoming';
	return k.final === k.games ? 'final' : 'playing';
}

/** A game's sides at a moment: points as the record holds them, or on Sunday the scored share of
 * each kicked-off starter's projection. */
function scoreboardAt(now: number, finalBy: number, sunday: boolean): Scoreboard {
	const byGame = new Map<number, SleeperMatchup[]>();
	for (const m of matchups) {
		const game = m.matchup_id ?? -m.roster_id;
		byGame.set(game, [...(byGame.get(game) ?? []), m]);
	}
	const games: ScoreboardGame[] = [...byGame.values()].map((pair) => {
		pair.sort((a, b) => Number(b.roster_id === sync.me) - Number(a.roster_id === sync.me));
		const all: PlayerLine[] = [];
		const sides = pair.map((m) => {
			const lines = m.starters
				.filter((id) => id !== '0')
				.map((id) => lineOf.get(id))
				.filter((l): l is PlayerLine => l !== undefined);
			all.push(...lines);
			const own = kicks(lines, now, finalBy);
			const projected = lines.filter((l) => l.week_projection !== null);
			const scored = lines.filter(
				(l) =>
					!l.facts.bye &&
					l.facts.kickoff !== null &&
					Date.parse(l.facts.kickoff) <= now &&
					l.week_projection !== null
			);
			return {
				roster_id: m.roster_id,
				points: sunday
					? tenth(scored.reduce((n, l) => n + (l.week_projection ?? 0) * SCORED_SHARE, 0))
					: m.points,
				points_read: true,
				projection:
					projected.length === 0
						? null
						: tenth(projected.reduce((n, l) => n + tenth(l.week_projection ?? 0), 0)),
				starters: m.starters.filter((id) => id !== '0').length,
				played: own.kicked
			};
		});
		const game = kicks(all, now, finalBy);
		return { state: stateOf(game), next_kickoff: game.next, sides };
	});
	games.sort(
		(a, b) => Number(b.sides[0]?.roster_id === sync.me) - Number(a.sides[0]?.roster_id === sync.me)
	);
	return {
		week: sync.week,
		read_at: sunday ? SUNDAY : READ_AT,
		projection_read_at: box.projection_read_at,
		projection_scoring: box.projection_scoring,
		games
	};
}

const recorded = Date.parse(READ_AT);
const sunday = Date.parse(SUNDAY);
/** On the Sunday stand-in the early games are over: every kickoff before noon Central is final. */
const SUNDAY_FINAL_BY = Date.parse('2026-10-18T17:00:00.000Z') - 1;

const style = await resolveConfig(fileURLToPath(DATA));
const answers = {
	sync: { ...sync, teams, moves: syncMoves, terms },
	scoreboard: scoreboardAt(recorded, 0, false),
	'scoreboard-live': scoreboardAt(sunday, SUNDAY_FINAL_BY, true)
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
