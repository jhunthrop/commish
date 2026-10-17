// Stamps the week's projection on the fixture's answers and writes the Matchup screen's box answer
// (Lane 66d), after build.ts:
//   - week_projection on every player line of lineup.json, waivers.json and trades.json, read as the
//     API reads it (api/internal/boards/projections.go): a player's by his board id, a defense's by
//     his club, a kicker with no row of his own by his club's one kicker, the PPR column (the league
//     scores most like PPR); null without a row;
//   - projection_read_at on the lineup, a stand-in stamp of the fixture's own Friday evening, and the
//     lineup's basis in the API's words since its rows end on the projection;
//   - matchup.json, GET /leagues/attached/{id}/matchup's answer: the drafter's side and the
//     opponent's, each starter in the league's slots in the host's order and the rest of the active
//     roster as the bench, every line taken from the answers above.
// The figures are data/projection.json: the one projection snapshot the dev store holds (week 1,
// captured 2026-09-09, the provider's published figures for every fixture player it lists, every
// kicker and every defense), standing in for week 6's until the dev store holds that capture. Only
// the shapes and the read rules are meant to hold.
//
//   node scripts/inseason-fixture/project.ts
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format as prettierFormat, resolveConfig } from 'prettier';
import type { GameWeek } from '../../src/lib/format/game-facts.ts';
import type { LeaguePlayer, LeagueSync } from '../../src/lib/league/api.ts';
import type {
	LineupAdvice,
	LineupSlot,
	MatchupBox,
	MatchupBoxSide,
	PlayerLine,
	TradeAdvice,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';

const DATA = new URL('./data/', import.meta.url);
/** The stand-in projection's read: Friday 9:00 pm Central of the fixture's week 6. */
const PROJECTION_READ_AT = '2026-10-17T02:00:00.000Z';
const DEFENSE = 'DEF';
const KICKER = 'K';
const PROVIDER_KICKER = 'PK';

interface ProjectionRow {
	position: string;
	team: string;
	ppr: number;
	half: number;
	standard: number;
}
interface Projection {
	players: Record<string, ProjectionRow>;
	defenses: Record<string, number>;
}

async function load<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8')) as T;
}

const [games, projection, sync, lineup, waivers, trades] = await Promise.all([
	load<GameWeek>('games'),
	load<Projection>('projection'),
	load<LeagueSync>('sync'),
	load<LineupAdvice>('lineup'),
	load<WaiverAdvice>('waivers'),
	load<TradeAdvice>('trades')
]);

/** The provider's club codes in the board's (boards.ProductTeam). */
const PRODUCT_TEAM: Readonly<Record<string, string>> = { WAS: 'WSH', LA: 'LAR' };
const club = (code: string): string => PRODUCT_TEAM[code] ?? code;

const kickers = new Map<string, number | null>();
for (const row of Object.values(projection.players)) {
	if (row.position !== PROVIDER_KICKER) continue;
	const team = club(row.team);
	kickers.set(team, kickers.has(team) ? null : row.ppr);
}
const defenses = new Map(Object.entries(projection.defenses).map(([c, v]) => [club(c), v]));

function weekProjection(line: PlayerLine): number | null {
	const { player } = line;
	if (player.position === DEFENSE) return defenses.get(club(player.team)) ?? null;
	const own = player.board_id === null ? undefined : projection.players[player.board_id];
	if (own) return own.ppr;
	return player.position === KICKER ? (kickers.get(club(player.team)) ?? null) : null;
}

/** Every player line in an answer, stamped, however deep. */
function stamp<T>(value: T): T {
	if (Array.isArray(value)) return value.map(stamp) as T;
	if (typeof value !== 'object' || value === null) return value;
	const entries = Object.entries(value).map(([key, field]) => [key, stamp(field)] as const);
	const out = Object.fromEntries(entries) as Record<string, unknown>;
	if ('player' in out && 'facts' in out && 'rest_of_season_per_game' in out) {
		out.week_projection = weekProjection(out as unknown as PlayerLine);
	}
	return out as T;
}

/** The lineup's basis and note as the API now words them (words.go LineupBasis, LineupNote): ranked
 * by no week's projection, and nothing said of points over replacement or points a game, which its
 * rows no longer show. */
function lineupBasis(basis: string): string {
	return basis
		.replace(
			"this week's designations. We do not project a week's points.",
			"this week's designations, not by a week's projection."
		)
		.replace(/ Points over replacement, and every gain in them, .*$/, '');
}

function lineupNote(note: string): string {
	return note.replace(/^Points over replacement are for [^.]*\. ?/, '');
}

const stampedLineup: LineupAdvice = {
	...stamp(lineup),
	basis: lineupBasis(lineup.basis),
	basis_note: lineupNote(lineup.basis_note),
	projection_read_at: PROJECTION_READ_AT
};
const stampedWaivers = stamp(waivers);
const stampedTrades = stamp(trades);

/** Every line the answers carry, by host id: the drafter's from the lineup, the rest from the trade
 * finder's rosters. */
const byHost = new Map<string, PlayerLine>();
for (const slot of stampedLineup.slots) {
	byHost.set(slot.ours.player.host_id, slot.ours);
	if (slot.host) byHost.set(slot.host.player.host_id, slot.host);
}
for (const line of stampedLineup.bench) byHost.set(line.player.host_id, line);
for (const team of stampedTrades.teams) {
	for (const line of team.roster) byHost.set(line.player.host_id, line);
}

/** A starter the answers above carry no line for (the opponent's, whom the trade finder lists only
 * in part): his host player with his club's week from games.json, his face from his board id. */
function lineOf(player: LeaguePlayer): PlayerLine {
	const game = games.games.find((g) => g.team === club(player.team)) ?? null;
	const line: PlayerLine = {
		player,
		headshot:
			player.board_id === null
				? null
				: `https://a.espncdn.com/i/headshots/nfl/players/full/${player.board_id}.png`,
		slug: null,
		position_rank: null,
		points_over_replacement: null,
		rest_of_season_per_game: null,
		week_projection: null,
		held: false,
		facts: {
			week: games.week,
			opponent: game?.opponent ?? null,
			home: game?.home ?? null,
			kickoff: game?.kickoff ?? null,
			bye: game === null,
			designation: null,
			played: game?.played ?? false,
			points_this_week: null,
			last_games: [],
			allowed_to_position: null,
			game_total: game?.game_total ?? null,
			spread: game?.spread ?? null,
			roof: game?.roof ?? null,
			weather: game?.weather ?? null
		}
	};
	return { ...line, week_projection: weekProjection(line) };
}

/** The league's starting slots in order, as the lineup answer lists them. */
const SLOTS = stampedLineup.slots.map((s) => s.slot);
const FLEX_TAKES = new Set(['RB', 'WR', 'TE']);
const takes = (slot: LineupSlot['slot'], position: string): boolean =>
	slot === position || (slot === 'FLEX' && FLEX_TAKES.has(position));

/** A side's box: its starters placed in the first open slot that takes each, in the host's order,
 * then its other active players as the bench. */
function boxSide(
	rosterId: number,
	starters: readonly LeaguePlayer[],
	roster: readonly PlayerLine[]
): MatchupBoxSide {
	const open = [...SLOTS];
	const placed: MatchupBoxSide['starters'] = [];
	for (const player of starters) {
		const line = byHost.get(player.host_id) ?? lineOf(player);
		const at = open.findIndex((slot) => takes(slot, line.player.position));
		if (at < 0) continue;
		placed.push({ slot: open[at] ?? 'FLEX', line });
		open.splice(at, 1);
	}
	placed.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
	const starting = new Set(placed.map((s) => s.line.player.host_id));
	return {
		roster_id: rosterId,
		starters: placed,
		bench: roster.filter((line) => !starting.has(line.player.host_id))
	};
}

const matchup = sync.matchup;
if (!matchup) throw new Error('The fixture league has no matchup this week.');
const myRoster = [...stampedLineup.slots.map((s) => s.ours), ...stampedLineup.bench];
const sides = [
	boxSide(
		matchup.mine.roster_id,
		matchup.mine.starters.map((s) => s.player),
		myRoster
	)
];
if (matchup.opponent) {
	const theirs = stampedTrades.teams.find((t) => t.roster_id === matchup.opponent?.roster_id);
	sides.push(
		boxSide(
			matchup.opponent.roster_id,
			matchup.opponent.starters.map((s) => s.player),
			theirs?.roster ?? []
		)
	);
}
const box: MatchupBox = {
	week: matchup.week,
	read_at: sync.read_at,
	projection_read_at: PROJECTION_READ_AT,
	sides
};

// Written as the repo's Prettier writes JSON, as build.ts writes the rest.
const style = await resolveConfig(fileURLToPath(DATA));
const answers = {
	lineup: stampedLineup,
	waivers: stampedWaivers,
	trades: stampedTrades,
	matchup: box
};
await Promise.all(
	Object.entries(answers).map(async ([name, body]) =>
		writeFile(
			new URL(`${name}.json`, DATA),
			await prettierFormat(JSON.stringify(body), { ...style, parser: 'json' })
		)
	)
);
const projected = [...byHost.values()].filter((l) => l.week_projection !== null).length;
process.stdout.write(
	`Projection stamped: ${String(projected)} of ${String(byHost.size)} rostered lines; matchup with ${String(sides.length)} sides.\n`
);
