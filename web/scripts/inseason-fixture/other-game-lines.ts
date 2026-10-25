// The full player lines of the one other game the shots tap (Lane 204 fix round 1, review M2): every
// active player of both its rosters, starters and bench, drawn as project.ts draws the captured free
// agents' lines: build.ts's line builder (run-lines.ts) over the stand-in run, each player placed on
// its board by name and position (sleeper-players.ts), his week projection the fixture's one snapshot
// (week-projection.ts), or where it holds no row his rest-of-season points a game (a stand-in, below). The other answers hold lines for the member's game alone, so another game drew
// only the few starters they happen to list; with these the box, the scoreboard's bug for that game
// and the Matchup's Team row all read the whole game, as the API's do. Injured reserve and taxi spots
// stay off, as the API's box leaves them. Writes data/other-game-lines.json.
//
//   node scripts/inseason-fixture/other-game-lines.ts   (reads .runs/runs/<latest>, npm run standin)
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';
import type { GameWeek } from '../../src/lib/format/game-facts.ts';
import type { LeaguePlayer } from '../../src/lib/league/api.ts';
import type { PlayerLine } from '../../src/lib/league/inseason/api.ts';
import { TAPPED_ROSTER } from './other-game.ts';
import { json, runLines, type BoardRow, type Game } from './run-lines.ts';
import type { SleeperMatchup } from './scoreboard-at.ts';
import { boardPlacer, sleeperName, type SleeperPlayer } from './sleeper-players.ts';
import { STANDARD_HORIZON, weeksCovered } from './week.ts';
import { weekProjectionOf, type Projection } from './week-projection.ts';

const DATA = new URL('./data/', import.meta.url);
const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const FORMAT = 'ppr-12';

interface SleeperRoster {
	roster_id: number;
	reserve: string[] | null;
	taxi: string[] | null;
}

const runId = (await json<{ runId: string }>(new URL('latest.json', RUNS))).runId;
const run = new URL(`${runId}/`, RUNS);
const [board, schedule, manifest, league, matchups, rosters, players, games, projection, state] =
	await Promise.all([
		json<{ rows: BoardRow[] }>(new URL(`boards/${FORMAT}.json`, run)),
		json<{ slates: { abbr: string; games: Game[] }[] }>(new URL('schedule.json', run)),
		json<{ formats: { id: string; rosFromWeek?: number }[] }>(new URL('manifest.json', run)),
		json<{ scoring_settings: Record<string, number> }>(new URL('league.json', REPLAY)),
		json<SleeperMatchup[]>(new URL('matchups.json', REPLAY)),
		json<SleeperRoster[]>(new URL('rosters.json', REPLAY)),
		json<Record<string, SleeperPlayer>>(new URL('players.json', REPLAY)),
		json<GameWeek>(new URL('games.json', DATA)),
		json<Projection>(new URL('projection.json', DATA)),
		json<{ week: number }>(new URL('state.json', REPLAY))
	]);

// A full-season run ranks from week 1; its order covers its own weeks, as project.ts divides.
const fromWeek = manifest.formats.find((f) => f.id === FORMAT)?.rosFromWeek ?? 1;
const { lineOf } = await runLines({
	run,
	rows: board.rows,
	slates: schedule.slates,
	fromWeek,
	week: state.week,
	weeksCovered: weeksCovered(fromWeek, STANDARD_HORIZON),
	scoring: league.scoring_settings,
	gameFacts: games
});
const placed = boardPlacer(board.rows, players);
const weekProjection = weekProjectionOf(projection);

/** A Sleeper player as the league read names him (build.ts leaguePlayer). */
function leaguePlayer(id: string): LeaguePlayer {
	const p = players[id];
	return {
		host_id: id,
		board_id: placed(id)?.id ?? null,
		name: p ? sleeperName(p) : id,
		position: p?.position ?? '',
		team: p?.team ?? '',
		injured_reserve: false
	};
}

const tapped = matchups.find((m) => m.roster_id === TAPPED_ROSTER);
if (tapped?.matchup_id == null) throw new Error(`Roster ${String(TAPPED_ROSTER)} has no game.`);
const sides = matchups.filter((m) => m.matchup_id === tapped.matchup_id);
const away = new Set(
	rosters
		.filter((r) => sides.some((s) => s.roster_id === r.roster_id))
		.flatMap((r) => [...(r.reserve ?? []), ...(r.taxi ?? [])])
);
const ids = sides.flatMap((s) => s.players).filter((id) => !away.has(id));
const lines: PlayerLine[] = await Promise.all(
	ids.map(async (id) => {
		const line = await lineOf(leaguePlayer(id));
		// STAND-IN: the snapshot was captured for the member's game's players and holds no row for most
		// of these; a player with a game and no row stands in at his rest-of-season points a game, so
		// the shots draw a whole box. Byes and clubs with no game keep none, as the API's rule.
		const held = weekProjection(line);
		const standIn =
			line.facts.bye || line.facts.opponent === null ? null : line.rest_of_season_per_game;
		return { ...line, week_projection: held ?? standIn };
	})
);

const style = await resolveConfig(fileURLToPath(DATA));
await writeFile(
	new URL('other-game-lines.json', DATA),
	await prettierFormat(JSON.stringify(lines), { ...style, parser: 'json' })
);
process.stdout.write(
	`Other game: rosters ${sides.map((s) => String(s.roster_id)).join(' and ')}, ${String(lines.length)} lines from run ${runId}.\n`
);
