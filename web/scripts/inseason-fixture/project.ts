// Stamps the week's projection on the fixture's answers and writes the Matchup screen's box answer
// (Lane 66d), after build.ts:
//   - week_projection on every player line of lineup.json, waivers.json and trades.json, read as the
//     API reads it (api/internal/boards/projections.go): a player's by his board id, a defense's by
//     his club, a kicker with no row of his own by his club's one kicker, the PPR column (the league
//     scores most like PPR); null without a row, and null for a club with no game this week (a bye),
//     whatever the snapshot holds;
//   - stand-in designations (Rome Odunze Questionable, Tank Bigsby on injured reserve, Chig Okonkwo
//     out) so a shot shows the status pill both ways and a spot no one can play;
//   - projection_scoring on both answers (PPR, the closest to the recorded league's own rules);
//   - projection_read_at on the lineup, a stand-in stamp of the fixture's own Friday evening, and the
//     lineup's basis in the API's words since its rows end on the projection;
//   - Lane 66e: the lineup advised as the API now advises it (words.go LineupBasis, engine.go
//     weekKeys): the highest Proj at each slot after the designations and byes, the rest-of-season
//     order breaking ties and standing in; the evidence on every line (opp_rank and its
//     allowed_to_position, season_avg, last_points from the held games, projection_delta) with the
//     read before's stamp; Tank Bigsby in an injured reserve spot, so the screen draws its section;
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
import type { DesignationStatus } from '../../src/lib/format/designation.ts';
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
/** The read before it: Thursday 9:00 pm Central, the change column's basis. */
const PREVIOUS_READ_AT = '2026-10-16T02:00:00.000Z';
/** The fixture's injured reserve spot: a bench player the host lists there. */
const IN_RESERVE = 'Tank Bigsby';
/** The recorded league scores by rules of its own, closest to PPR: the API's projection_scoring. */
const PROJECTION_SCORING: LineupAdvice['projection_scoring'] = { format: 'ppr', league_own: false };
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
	const { player, facts } = line;
	// A club with no game this week has no projection, whatever the snapshot holds (the API's rule).
	if (facts.bye || facts.opponent === null) return null;
	if (player.position === DEFENSE) return defenses.get(club(player.team)) ?? null;
	const own = player.board_id === null ? undefined : projection.players[player.board_id];
	if (own) return own.ppr;
	return player.position === KICKER ? (kickers.get(club(player.team)) ?? null) : null;
}

/** Every player line in an answer, stamped, however deep. */
/** Two stand-in designations, so a shot shows Lane 63's pill both ways (review M2): one starter
 * Questionable on the week's report, one bench player on injured reserve. The run holds no
 * designations for the recorded week; these are the fixture's own. */
const DESIGNATED_AS_OF = '2026-10-16T21:00:00.000Z';
const DESIGNATIONS: Readonly<Record<string, DesignationStatus>> = {
	'Rome Odunze': 'questionable',
	'Tank Bigsby': 'injured_reserve',
	// Lane 66e: the bench's one tight end is out while the starter is on bye, so the TE spot has no
	// one who can play and a shot shows its chip and its row.
	'Chig Okonkwo': 'out'
};

function designated(line: PlayerLine): PlayerLine {
	const status = DESIGNATIONS[line.player.name];
	if (status === undefined) return line;
	return { ...line, facts: { ...line.facts, designation: { status, as_of: DESIGNATED_AS_OF } } };
}

/** A small stable number from words, for the stand-in evidence: the same line stamps alike on every
 * run. */
function seed(words: string): number {
	let h = 0;
	for (const c of words) h = (h * 31 + c.charCodeAt(0)) % 9973;
	return h;
}

const RANKED = 32;
const DELTA_SPREAD = 9;
const DELTA_MIDDLE = 4;
const TENTH = 10;
const CENTS = 100;

/** The evidence columns (Lane 66e), stand-ins where the fixture holds no read: the opponent's rank
 * against his position from his opponent and position (with allowed_to_position to match), his
 * points a game and his last game's from the games the fixture holds, and a change since the read
 * before within half a point. */
function evidenced(line: PlayerLine, projected: number | null): PlayerLine {
	const { facts, player } = line;
	const games = facts.last_games;
	const avg =
		games.length === 0
			? null
			: Math.round((games.reduce((a, g) => a + g.points, 0) / games.length) * CENTS) / CENTS;
	// The API ranks no defense (facts.go allowedPositions), so a defense has none here either.
	const rank =
		facts.bye || facts.opponent === null || player.position === DEFENSE
			? null
			: (seed(facts.opponent + player.position) % RANKED) + 1;
	const allowed =
		rank === null
			? null
			: {
					points_a_game: Math.round((30 - rank * 0.6) * TENTH) / TENTH,
					rank,
					of: RANKED,
					position: player.position
				};
	return {
		...line,
		week_projection: projected,
		projection_delta:
			projected === null ? null : ((seed(player.name) % DELTA_SPREAD) - DELTA_MIDDLE) / TENTH,
		opp_rank: rank,
		season_avg: avg,
		last_points: games[0]?.points ?? null,
		facts: { ...facts, allowed_to_position: allowed }
	};
}

function stamp<T>(value: T): T {
	if (Array.isArray(value)) return value.map(stamp) as T;
	if (typeof value !== 'object' || value === null) return value;
	const entries = Object.entries(value).map(([key, field]) => [key, stamp(field)] as const);
	const out = Object.fromEntries(entries) as Record<string, unknown>;
	if ('player' in out && 'facts' in out && 'rest_of_season_per_game' in out) {
		const line = designated(out as unknown as PlayerLine);
		return evidenced(line, weekProjection(line)) as T;
	}
	return out as T;
}

/** The week's order the API's lineup now follows (engine.go weekKeys): who may start (a bye or a
 * designation that keeps him off the field last, doubtful before them), then the Proj as printed,
 * a player with one first, then the rest-of-season order. */
const tierOf = (l: PlayerLine): number => {
	if (l.facts.bye) return 2;
	const status = l.facts.designation?.status;
	if (status === undefined || status === 'questionable') return 0;
	return status === 'doubtful' ? 1 : 2;
};
const printedProj = (l: PlayerLine): number | null =>
	l.week_projection === null ? null : Math.round(l.week_projection * TENTH) / TENTH;
function better(a: PlayerLine, b: PlayerLine): number {
	const tier = tierOf(a) - tierOf(b);
	if (tier !== 0) return tier;
	const pa = printedProj(a);
	const pb = printedProj(b);
	if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
	if (pa !== null && pb !== null && pa !== pb) return pb - pa;
	const ra = a.position_rank ?? Number.MAX_SAFE_INTEGER;
	const rb = b.position_rank ?? Number.MAX_SAFE_INTEGER;
	if (ra !== rb) return ra - rb;
	return (b.points_over_replacement ?? 0) - (a.points_over_replacement ?? 0);
}

const FLEX_POSITIONS = new Set(['RB', 'WR', 'TE']);
const accepts = (slot: LineupSlot['slot'], position: string): boolean =>
	slot === position || (slot === 'FLEX' && FLEX_POSITIONS.has(position));

/** A change's sentence as the API words it (sentences.go): the bye that forces it, else the Proj. */
function changeWords(ours: PlayerLine, host: PlayerLine | null): string {
	const last = (l: PlayerLine): string => l.player.name.trim().split(/\s+/).at(-1) ?? l.player.name;
	if (host === null) return `This spot is empty in your lineup, so ${last(ours)} takes it.`;
	if (host.facts.bye) return `${host.player.name} is on bye this week, so ${last(ours)} starts.`;
	const a = printedProj(ours);
	const b = printedProj(host);
	if (a !== null && b !== null && a > b) {
		return `${last(ours)} has ${a.toFixed(1)} Proj this week against ${last(host)}'s ${b.toFixed(1)}.`;
	}
	return `${last(ours)} is ahead of ${last(host)} in our rest-of-season order.`;
}

/** The lineup advised by the week's order: each slot's player from the active roster (the
 * position's own slots first, then the flex), each host starter kept in his own spot, a change
 * paired with the host's starter it sits in that spot or of his position. */
function advise(advice: LineupAdvice): LineupAdvice {
	const hostAt = advice.slots.map((s) => s.host);
	const seen = new Set<string>();
	const pool = [
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench
	]
		.filter((l) => {
			if (seen.has(l.player.host_id)) return false;
			seen.add(l.player.host_id);
			return true;
		})
		.filter((l) => l.player.name !== IN_RESERVE);
	const order = [...pool].sort(better);
	const kinds = advice.slots.map((s) => s.slot);
	const chosen = new Set<string>();
	const pick = (slot: LineupSlot['slot']): void => {
		// A player who cannot play this week never starts (the API's rule, engine.go).
		const best = order.find(
			(l) => tierOf(l) === 0 && !chosen.has(l.player.host_id) && accepts(slot, l.player.position)
		);
		if (best) chosen.add(best.player.host_id);
	};
	kinds.filter((k) => k !== 'FLEX').forEach(pick);
	kinds.filter((k) => k === 'FLEX').forEach(pick);
	const placed: (PlayerLine | null)[] = kinds.map((kind, i) => {
		const h = hostAt[i];
		return h && chosen.has(h.player.host_id) && accepts(kind, h.player.position) ? h : null;
	});
	const hostIds = new Set(hostAt.flatMap((h) => (h ? [h.player.host_id] : [])));
	const fresh = order.filter((l) => chosen.has(l.player.host_id) && !hostIds.has(l.player.host_id));
	const keptIds = new Set(placed.flatMap((l) => (l ? [l.player.host_id] : [])));
	const stray = order.filter(
		(l) =>
			chosen.has(l.player.host_id) &&
			hostIds.has(l.player.host_id) &&
			!keptIds.has(l.player.host_id)
	);
	for (const l of [...fresh, ...stray]) {
		const at = placed.findIndex(
			(p, i) => p === null && accepts(kinds[i] ?? 'FLEX', l.player.position)
		);
		if (at >= 0) placed[at] = l;
	}
	// A spot no one who can play fills keeps the member's player there, marked (keepWhereNoOneCanPlay).
	const idle = new Set<string>();
	placed.forEach((p, i) => {
		const h = hostAt[i];
		if (p === null && h && !chosen.has(h.player.host_id)) {
			placed[i] = h;
			chosen.add(h.player.host_id);
			idle.add(h.player.host_id);
		}
	});
	// Then any member's starter left over, into any empty spot that takes him (review N1).
	placed.forEach((p, i) => {
		if (p !== null) return;
		const h = hostAt.find(
			(l) => l && !chosen.has(l.player.host_id) && accepts(kinds[i] ?? 'FLEX', l.player.position)
		);
		if (h) {
			placed[i] = h;
			chosen.add(h.player.host_id);
			idle.add(h.player.host_id);
		}
	});
	const sat = hostAt.filter((h): h is PlayerLine => h !== null && !chosen.has(h.player.host_id));
	const slots = advice.slots.flatMap((slot, i): LineupSlot[] => {
		const ours = placed[i];
		if (!ours) return [];
		if (hostIds.has(ours.player.host_id)) {
			return [
				{
					slot: slot.slot,
					ours,
					host: ours,
					changed: false,
					no_one_can_play: idle.has(ours.player.host_id),
					sentence: null
				}
			];
		}
		const own = hostAt[i];
		const host =
			own && sat.includes(own)
				? own
				: (sat.find((l) => l.player.position === ours.player.position) ?? sat[0] ?? null);
		if (host) sat.splice(sat.indexOf(host), 1);
		return [
			{
				slot: slot.slot,
				ours,
				host,
				changed: true,
				no_one_can_play: false,
				sentence: changeWords(ours, host)
			}
		];
	});
	const starting = new Set(slots.map((s) => s.ours.player.host_id));
	const reserved = [...advice.reserve, ...advice.bench, ...pool]
		.filter((l) => l.player.name === IN_RESERVE)
		.slice(0, 1)
		.map((l) => ({ ...l, player: { ...l.player, injured_reserve: true } }));
	return {
		...advice,
		set: slots.every((s) => !s.changed),
		slots,
		bench: pool.filter((l) => !starting.has(l.player.host_id)).sort(better),
		reserve: reserved
	};
}

/** The lineup's basis as the API now words it (words.go LineupBasis, Lane 66e). */
const LINEUP_BASIS =
	"We start the highest Proj at each slot, after this week's designations and byes. A player who cannot play this week never starts. Our rest-of-season order breaks ties and stands in where a player has no Proj.";

function lineupNote(note: string): string {
	return note.replace(/^Points over replacement are for [^.]*\. ?/, '');
}

const stampedLineup: LineupAdvice = {
	// A lineup.json from before Lane 66e has no reserve.
	...advise(
		stamp({
			...lineup,
			reserve: (lineup as Partial<LineupAdvice>).reserve ?? [],
			empty_slots: []
		})
	),
	basis: LINEUP_BASIS,
	projection_previous_read_at: PREVIOUS_READ_AT,
	// Sleeper takes no lineup from our screen: the API's line under the copy verb (inseason CopyOnlyMoves).
	moves: {
		lineup: 'unavailable',
		note: null,
		takes_writes: false,
		writes_on: false,
		reason: 'Sleeper does not take lineups from here, so copy the lineup there.'
	},
	basis_note: lineupNote(lineup.basis_note),
	projection_read_at: PROJECTION_READ_AT,
	projection_scoring: PROJECTION_SCORING,
	// Sleeper gives each player's points; no game has kicked off in the recorded week.
	player_points: true,
	team_points: null
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
for (const line of [...stampedLineup.bench, ...stampedLineup.reserve])
	byHost.set(line.player.host_id, line);
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
		projection_delta: null,
		opp_rank: null,
		season_avg: null,
		last_points: null,
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
	return evidenced(line, weekProjection(line));
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
		// Sleeper gives each player's points.
		player_points: true,
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
	projection_scoring: PROJECTION_SCORING,
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
