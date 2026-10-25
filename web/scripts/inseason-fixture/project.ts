// Stamps the week's projection on the fixture's answers and writes the Matchup screen's box answer
// (Lane 66d), after build.ts:
//   - week_projection on every player line of lineup.json, waivers.json and trades.json, read as the
//     API reads it (api/internal/boards/projections.go): a player's by his board id, a defense's by
//     his club, a kicker with no row of his own by his club's one kicker, the PPR column (the league
//     scores most like PPR); null without a row, and null for a club with no game this week (a bye),
//     whatever the snapshot holds;
//   - the season-long lists of the capture the stand-in run is marked with (scripts/
//     standin-designations.json, Lane 128), each such line with no rest-of-season rank, as the API
//     sends it; and stand-in week designations (Rome Odunze Questionable, Chig Okonkwo out) so a shot
//     shows the status pill both ways and a spot no one can play;
//   - Lane 132 (B111): every free agent the capture lists kept in the waiver answer, each line drawn
//     from the stand-in run by build.ts's line builder (run-lines.ts) with the capture's status;
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
	TradeRow,
	WaiverAdvice
} from '../../src/lib/league/inseason/api.ts';
import { lastName } from '../../src/lib/format/draft.ts';
import { designationsSchema } from '../../src/lib/run/schema.ts';
import { IN_RESERVE, advise } from './advise.ts';
import {
	capturedFreeAgents,
	isStandInRow,
	json,
	runLines,
	type BoardRow,
	type FixtureWaiverRow,
	type Game
} from './run-lines.ts';
import { standInLineup } from './stand-in-lineup.ts';
import { club, weekProjectionOf, type Projection } from './week-projection.ts';
import {
	accepts,
	better,
	CHECK_BASIS,
	LINEUP_BASIS,
	PER_GAME_BASIS,
	uncountedOf,
	WAIVERS_BASIS,
	waiverSeasonBasis,
	tradesBases,
	lineupProj,
	printedProj,
	seasonStarters,
	slotLabel,
	tenth,
	tierOf,
	weekSlots,
	weeksCovered,
	STANDARD_HORIZON
} from './week.ts';

const DATA = new URL('./data/', import.meta.url);
/** The recorded Sleeper league, whose scoring rules a run's game logs are scored with. */
const REPLAY = new URL('../../../api/internal/leaguesync/replay/sleeper/', import.meta.url);
/** The stand-in projection's read: Friday 9:00 pm Central of the fixture's week 6. */
const PROJECTION_READ_AT = '2026-10-17T02:00:00.000Z';
/** The read before it: Thursday 9:00 pm Central, the change column's basis. */
const PREVIOUS_READ_AT = '2026-10-16T02:00:00.000Z';
/** The fixture's injured reserve spot: a bench player the host lists there. */
/** The recorded league scores by rules of its own, closest to PPR: the API's projection_scoring. */
const PROJECTION_SCORING: LineupAdvice['projection_scoring'] = { format: 'ppr', league_own: false };
const DEFENSE = 'DEF';

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

const weekProjection = weekProjectionOf(projection);

/** Every player line in an answer, stamped, however deep. */
/** Two stand-in designations, so a shot shows Lane 63's pill both ways (review M2): one starter
 * Questionable on the week's report, and the bench's one tight end out. These week designations are
 * the fixture's own. */
const DESIGNATED_AS_OF = '2026-10-16T21:00:00.000Z';
const DESIGNATIONS: Readonly<Record<string, DesignationStatus>> = {
	'Rome Odunze': 'questionable',
	// Lane 66e: the bench's one tight end is out while the starter is on bye, so the TE spot has no
	// one who can play and a shot shows its chip and its row.
	'Chig Okonkwo': 'out'
};

/** The season-long lists the stand-in run is marked with (scripts/standin-designations.json, Lane
 * 128): the league reads the one capture the run's pages read, so a row and his card never disagree
 * on who is on injured reserve. A week's status there is left to the fixture's own week above. */
const CAPTURE = designationsSchema.parse(
	JSON.parse(await readFile(new URL('../standin-designations.json', import.meta.url), 'utf8'))
);
const SEASON_LONG = new Map(
	Object.entries(CAPTURE.players).filter(([, status]) => status.seasonLong)
);
/** The capture's players designated to return this week (Lane 153): Travis Etienne, back Sunday. */
const RETURNING = new Map(
	Object.entries(CAPTURE.players).filter(
		([, status]) => !status.seasonLong && status.returning !== undefined
	)
);

/** The stand-in run's position ranks, playing first (run-from-mock-data.ts playingFirst, the API's
 * PlayingRanks, Lane 128 review fix round 2): one position rank per player on every screen. */
const RUNS = new URL('../../.runs/runs/', import.meta.url);
const RUN_ID = (
	JSON.parse(await readFile(new URL('latest.json', RUNS), 'utf8')) as { runId: string }
).runId;
const PLAYING_RANKS = new Map(
	(
		JSON.parse(await readFile(new URL(`${RUN_ID}/boards/ppr-12.json`, RUNS), 'utf8')) as {
			rows: { id: string; positionRank: number }[];
		}
	).rows.map((row) => [row.id, row.positionRank])
);

/** The member's lines as the answers hold them: the lineup's slots, its bench and its reserve, the
 * roster build.ts gains each add over. */
function memberLines(advice: LineupAdvice): PlayerLine[] {
	return [
		...advice.slots.map((s) => s.ours),
		...advice.bench,
		...((advice as Partial<LineupAdvice>).reserve ?? [])
	];
}

/** The free agents the capture lists (Lane 132, B111): the API reads each free agent's designation,
 * so the waiver answer keeps every one, listed or held out, each line drawn from the stand-in run by
 * build.ts's own line builder (run-lines.ts) and carrying the capture's status. STAND-INS (B118): each
 * row is labelled `standin` (run-lines.ts FixtureWaiverRow, never served); his line is the stand-in
 * run's, a preseason order, so his rank is that board's and his points over replacement a week are
 * over that run's own weeks (week 1 through the horizon); his drop and gain are build.ts's rule over
 * the member's lines (stand-in-lineup.ts), never pinned. A rerun drops the labelled rows it added
 * before and draws them again. */
async function capturedRows(answer: WaiverAdvice): Promise<FixtureWaiverRow[]> {
	const run = new URL(`${RUN_ID}/`, RUNS);
	const [board, schedule, manifest, league] = await Promise.all([
		json<{ rows: BoardRow[] }>(new URL('boards/ppr-12.json', run)),
		json<{ slates: { abbr: string; games: Game[] }[] }>(new URL('schedule.json', run)),
		json<{ formats: { id: string; rosFromWeek?: number }[] }>(new URL('manifest.json', run)),
		json<{ scoring_settings: Record<string, number>; roster_positions: string[] }>(
			new URL('league.json', REPLAY)
		)
	]);
	// A full-season run ranks from week 1.
	const fromWeek = manifest.formats.find((f) => f.id === 'ppr-12')?.rosFromWeek ?? 1;
	const { boardLine } = await runLines({
		run,
		rows: board.rows,
		slates: schedule.slates,
		fromWeek,
		week: answer.week,
		// The run's order covers its own weeks, from its first: a week's share of its points.
		weeksCovered: weeksCovered(fromWeek, STANDARD_HORIZON),
		scoring: league.scoring_settings,
		gameFacts: games
	});
	const { waiverAdd } = standInLineup(league.roster_positions);
	const mine = memberLines(lineup);
	const kept = new Set(answer.rows.map((r) => r.add.player.board_id));
	const listed = capturedFreeAgents(
		board.rows,
		new Set(Object.keys(CAPTURE.players)),
		new Set(Object.keys(sync.held_by))
	).filter((row) => !kept.has(row.id));
	return Promise.all(
		listed.map(async (row) => {
			const status = CAPTURE.players[row.id];
			const drawn = await boardLine(row);
			const add: PlayerLine =
				status === undefined
					? drawn
					: {
							...drawn,
							facts: {
								...drawn.facts,
								designation: {
									status: status.status,
									as_of: CAPTURE.readAt,
									...(status.returning === undefined ? {} : { returning: status.returning })
								}
							}
						};
			return {
				add,
				...waiverAdd(add, mine),
				standin: true,
				week_gain: 0,
				pickup: false,
				beats: null,
				drops: [],
				clears: null
			};
		})
	);
}

/** His designation on the week: a season-long list from the run's capture (with no rest-of-season
 * rank, the in-season order never ranking him as playing), else the fixture's week stand-in, his rank
 * the run's playing-first one. */
function designated(line: PlayerLine): PlayerLine {
	const listed = line.player.board_id === null ? undefined : SEASON_LONG.get(line.player.board_id);
	if (listed !== undefined) {
		const designation = {
			status: listed.status,
			as_of: CAPTURE.readAt,
			since: listed.since,
			season_long: true
		};
		return { ...line, position_rank: null, facts: { ...line.facts, designation } };
	}
	const ranked = playingRank(line);
	// Designated to return this week (Lane 153): the capture's week question with his day, ranked as
	// playing, as the API sends it.
	const back = line.player.board_id === null ? undefined : RETURNING.get(line.player.board_id);
	const id = line.player.board_id;
	if (id !== null && back?.returning !== undefined) {
		const designation = { status: back.status, as_of: CAPTURE.readAt, returning: back.returning };
		const rank = PLAYING_RANKS.get(id) ?? ranked.position_rank;
		return { ...ranked, position_rank: rank, facts: { ...line.facts, designation } };
	}
	const status = DESIGNATIONS[line.player.name];
	if (status === undefined) return ranked;
	return { ...ranked, facts: { ...line.facts, designation: { status, as_of: DESIGNATED_AS_OF } } };
}

/** His line with the run's playing-first position rank, where it ranks him. */
function playingRank(line: PlayerLine): PlayerLine {
	const id = line.player.board_id;
	const rank = id === null || line.position_rank === null ? undefined : PLAYING_RANKS.get(id);
	return rank === undefined ? line : { ...line, position_rank: rank };
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
	...uncountedOf(lineup.uncounted_rules),
	projection_read_at: PROJECTION_READ_AT,
	projection_scoring: PROJECTION_SCORING,
	// Sleeper gives each player's points; no game has kicked off in the recorded week.
	player_points: true,
	team_points: null
};
/** Lane 66f: an unrostered defense in the pool, so the table shows a club mark with its Proj (the
 * recorded league starts no kicker, so its pool holds none). A stand-in pick: the fixture does not
 * hold every roster's defense. */
const POOL_DEFENSE: LeaguePlayer = {
	host_id: '',
	board_id: null,
	name: 'Kansas City Chiefs',
	position: DEFENSE,
	team: 'KC',
	injured_reserve: false
};

/** The lineup the advice sets this week from a roster, by the Lineup's rule (the order above): its
 * Proj as printed and summed, who starts, and the slots no one who can play fills. */
function weekFill(roster: readonly PlayerLine[]): {
	proj: number;
	starts: Set<string>;
	idle: Set<string>;
} {
	const order = [...roster].sort(better);
	const kinds = stampedLineup.slots.map((s) => s.slot);
	const chosen = new Set<string>();
	const idle = new Set<string>();
	const pick = (slot: LineupSlot['slot']): void => {
		const best = order.find(
			(l) => tierOf(l) === 0 && !chosen.has(l.player.host_id) && accepts(slot, l.player.position)
		);
		if (best) chosen.add(best.player.host_id);
		else idle.add(slot);
	};
	kinds.filter((k) => k !== 'FLEX').forEach(pick);
	kinds.filter((k) => k === 'FLEX').forEach(pick);
	const proj = order
		.filter((l) => chosen.has(l.player.host_id))
		.reduce((sum, l) => sum + (printedProj(l) ?? 0), 0);
	return { proj: Math.round(proj * TENTH) / TENTH, starts: chosen, idle };
}

const MAX_PICKUPS = 3;

/** Lane 66f's waiver fields, as the API answers them (inseason pickups.go), on the fixture's own
 * figures: this week's Proj gain on the Lineup's rule, whom he beats (the lowest Proj he tops at his
 * position, starters first, never a player who cannot play) or the open spot he fills, the pickup
 * rule, the strip's cards chosen as a set (each measured against the lineup with the cards before it
 * made, one key for the player topped and the player dropped) with the set's Proj, and every drop
 * with both gains. The rest-of-season gain of a drop other than the row's own is a stand-in: the
 * row's gain moved by the difference in the two players' points over replacement. No waiver day:
 * Sleeper gives none (Yahoo alone does). */
function pickupTable(advice: WaiverAdvice): WaiverAdvice {
	const roster = [...stampedLineup.slots.map((s) => s.ours), ...stampedLineup.bench];
	const base = weekFill(roster);
	// An add is named by his board id until a platform names him (the API's pool row).
	const key = (l: PlayerLine): string =>
		l.player.host_id || `board:${l.player.board_id ?? l.player.name}`;
	const named = (l: PlayerLine): PlayerLine => ({ ...l, player: { ...l.player, host_id: key(l) } });
	const swap = (
		on: readonly PlayerLine[],
		add: PlayerLine,
		drop: PlayerLine | null
	): { after: PlayerLine[]; proj: number; starts: boolean } => {
		const after = [...on.filter((l) => l.player.host_id !== drop?.player.host_id), named(add)];
		const fill = weekFill(after);
		return { after, proj: fill.proj, starts: fill.starts.has(key(add)) };
	};
	const week = (add: PlayerLine, drop: PlayerLine | null): { gain: number; starts: boolean } => {
		const { proj, starts } = swap(roster, add, drop);
		return { gain: starts ? tenth(proj - base.proj) : 0, starts };
	};
	const beats = (add: PlayerLine): WaiverAdvice['rows'][number]['beats'] => {
		const proj = printedProj(add);
		if (proj === null || tierOf(add) !== 0) return null;
		for (const starter of [true, false]) {
			const topped = roster.filter((l) => {
				const p = printedProj(l);
				return (
					l.player.position === add.player.position &&
					tierOf(l) === 0 &&
					p !== null &&
					p < proj &&
					base.starts.has(l.player.host_id) === starter
				);
			});
			const low = topped.sort((a, b) => (printedProj(a) ?? 0) - (printedProj(b) ?? 0))[0];
			if (low) {
				return {
					host_id: low.player.host_id,
					name: low.player.name,
					starter,
					gain: tenth(proj - (printedProj(low) ?? 0)),
					open_spot: false
				};
			}
		}
		return null;
	};
	const por = (l: PlayerLine | null): number => l?.points_over_replacement ?? 0;
	const defense = lineOf(POOL_DEFENSE);
	// The defense's row is added once: a rerun reads this file back.
	const pool = [
		...advice.rows.filter((r) => r.add.player.name !== POOL_DEFENSE.name),
		{
			add: defense,
			drop: stampedLineup.slots.find((s) => s.slot === 'DEF')?.ours ?? null,
			gain: 0.3,
			starts: false,
			sentence: `${defense.player.name} would start for you this week on the Proj shown.`,
			week_gain: 0,
			pickup: false,
			beats: null,
			drops: [],
			clears: null
		}
	];
	const bench = stampedLineup.bench.filter((l) => !l.held && l.player.name !== IN_RESERVE);
	// The drop it costs least to lose, as the API picks it: the bench player with the least points
	// over replacement; a defense for a defense, the starter he replaces.
	const cheapest = [...bench].sort((a, b) => por(a) - por(b))[0] ?? null;
	const seasonStarts = new Set(
		seasonStarters(
			roster,
			stampedLineup.slots.map((s) => s.slot)
		).map((l) => l.player.host_id)
	);
	// The drop panel hides nothing (coordinator's ruling, Lane 66u): every player the member could
	// drop, this week's starters marked; the defense's second is droppable, as the API's position rule
	// allows with two on the roster.
	const panel = [
		...bench,
		...stampedLineup.slots.map((s) => s.ours).filter((l) => !l.held && !bench.includes(l))
	];
	const rows = pool.map((source): WaiverAdvice['rows'][number] => {
		const row = source.add.player.position === DEFENSE ? source : { ...source, drop: cheapest };
		const own = week(row.add, row.drop);
		// A defense replaces the starting defense alone; a skill player any player on the panel. The
		// row's own drop is the API's rule on these figures: the largest rest-of-season gain among the
		// drops that keep this week's lineup full, a bench player first and the cheapest when gains tie,
		// so the cheapest bench player the rest-of-season lineup does not start.
		const choices = source.add.player.position === DEFENSE ? (row.drop ? [row.drop] : []) : panel;
		const drops = choices
			.map((d) => ({
				host_id: d.player.host_id,
				// A player the rest-of-season lineup does not start costs it nothing, as in the API's
				// strength; a starter's loss stands in as the swing in points over replacement.
				gain: seasonStarts.has(d.player.host_id)
					? tenth(row.gain + por(row.drop) - por(d))
					: row.gain,
				week_gain: week(row.add, d).gain,
				starts_this_week: base.starts.has(d.player.host_id)
			}))
			.sort((a, b) =>
				a.host_id === row.drop?.player.host_id
					? -1
					: b.host_id === row.drop?.player.host_id
						? 1
						: b.gain - a.gain
			);
		// The open spot: he starts where no one of the member's can play this week.
		const open = own.starts && base.idle.has(row.add.player.position);
		const out = {
			...row,
			week_gain: own.gain,
			starts: own.starts,
			beats: open
				? { host_id: '', name: '', starter: true, gain: own.gain, open_spot: true }
				: beats(row.add),
			drops,
			clears: null
		};
		return { ...out, pickup: out.starts && out.week_gain > 0 && tenth(out.gain) >= 0 };
	});
	// The strip as a set, as the API chooses it.
	const used = new Set<string>();
	const pickups: WaiverAdvice['rows'] = [];
	let on = roster;
	let proj = base.proj;
	for (const r of rows
		.filter((x) => x.pickup)
		.sort((a, b) => (b.week_gain ?? 0) - (a.week_gain ?? 0))) {
		if (pickups.length === MAX_PICKUPS) break;
		const keys = [
			...(r.beats && !r.beats.open_spot ? [r.beats.host_id] : []),
			...(r.drop ? [r.drop.player.host_id] : [])
		];
		if (keys.some((k) => used.has(k))) continue;
		const next = swap(on, r.add, r.drop);
		const gain = tenth(next.proj - proj);
		if (!next.starts || gain <= 0) continue;
		keys.forEach((k) => used.add(k));
		on = next.after;
		proj = next.proj;
		pickups.push({ ...r, week_gain: gain });
	}
	return {
		...advice,
		basis: WAIVERS_BASIS,
		pickup_order: 'week',
		season_basis: waiverSeasonBasis(weeksCovered(advice.week, STANDARD_HORIZON), STANDARD_HORIZON),
		...uncountedOf(lineup.uncounted_rules),
		rows,
		pickups,
		roster,
		lineup_proj: base.proj,
		pickups_proj: proj,
		// Sleeper takes no claim from our screen: the API's line under the verb (inseason CopyOnlyClaims).
		moves: {
			claim: 'unavailable',
			note: null,
			takes_writes: false,
			writes_on: false,
			reason: 'Sleeper does not take claims from here, so add him on its waiver page.'
		},
		projection_read_at: PROJECTION_READ_AT,
		projection_previous_read_at: PREVIOUS_READ_AT,
		projection_scoring: PROJECTION_SCORING
	};
}

/** The answer build.ts wrote: the rows a run before this one added are drawn again. */
const builtWaivers = { ...waivers, rows: waivers.rows.filter((r) => !isStandInRow(r)) };
const stampedWaivers = pickupTable(
	stamp({ ...builtWaivers, rows: [...builtWaivers.rows, ...(await capturedRows(builtWaivers))] })
);
const stampedFinder = stamp(trades);

/** Every line the answers carry, by host id: the drafter's from the lineup, the rest from the trade
 * finder's rosters. */
const byHost = new Map<string, PlayerLine>();
for (const slot of stampedLineup.slots) {
	byHost.set(slot.ours.player.host_id, slot.ours);
	if (slot.host) byHost.set(slot.host.player.host_id, slot.host);
}
for (const line of [...stampedLineup.bench, ...stampedLineup.reserve])
	byHost.set(line.player.host_id, line);
for (const team of stampedFinder.teams) {
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
		// Sleeper gives each player's points, and its score is theirs added (Lane 79 ruling a).
		player_points: true,
		team_total: false,
		starters: placed,
		bench: roster.filter((line) => !starting.has(line.player.host_id))
	};
}

const matchup = sync.matchup;
if (!matchup) throw new Error('The fixture league has no matchup this week.');

/** The trade's sentence when its drop starts this week, in the API's words (sentences.go TradeDrop). */
function dropReason(drop: PlayerLine, by: PlayerLine, slot: string, bySlot: string): string {
	const dropped = lastName(drop.player.name);
	const taker = lastName(by.player.name);
	return slot === bySlot
		? `${dropped} starts at ${slot} for you this week, and ${taker} takes that spot after the trade.`
		: `${dropped} starts at ${slot} for you this week. After the trade ${taker} starts at ${bySlot} and your lineup stays full.`;
}

/** The one stand-in starter drop (review 66u finding 3): the best trade with one team, answered as
 * though the member held his bench and the starters named (the three our order values least), so
 * its only drop is a starter and a shot shows the trade's sentence. Every other row keeps the rule on
 * the roster as it is. */
const STARTER_DROP_STANDIN = {
	team: 'Bower Rangers',
	holds: ['Jaxson Dart', 'Ladd McConkey', 'Travis Etienne']
} as const;

/** Each trade's drop against this week's lineup, a stand-in simplification of the API's rule (inseason
 * drops.go recommend, Lane 66u). The API takes the largest rest-of-season gain among the drops that
 * keep this week's lineup full, then the higher Proj kept, a bench player before a starter, then the
 * player our order values least. Here the candidates are only the players the rest-of-season lineup
 * does not start after the trade, never held, never the only defense; those all share the trade's
 * gain, and dropping a bench player keeps the most Proj, so the rule reduces to: the cheapest bench
 * player, else the cheapest starter whose place a player brought in takes with the lineup kept full,
 * the trade then naming the slot that player takes. The Proj kept is not compared among starters the
 * lineup still starts. A trade with no one to drop is not listed. */
function followLineup(finder: TradeAdvice): TradeAdvice {
	const id = (l: PlayerLine): string => l.player.host_id;
	const roster = [...stampedLineup.slots.map((s) => s.ours), ...stampedLineup.bench];
	const base = weekSlots(roster, SLOTS);
	const spotOf = new Map(base.flatMap((l, at) => (l === null ? [] : [[id(l), at] as const])));
	const defenseSlots = SLOTS.filter((s) => s === DEFENSE).length;
	/** A starter's row on the Lineup screen, whose slot the sentence names. */
	const rowOf = (l: PlayerLine): number => stampedLineup.slots.findIndex((s) => s.ours === l);
	const cost = (a: PlayerLine, b: PlayerLine): number =>
		(a.points_over_replacement ?? 0) - (b.points_over_replacement ?? 0) ||
		(b.position_rank ?? 0) - (a.position_rank ?? 0);
	/** Who takes a dropped starter's place: the lineup after fills every slot it filled, and an incoming
	 * player starts, the one in his own spot first. */
	const takes = (
		after: readonly PlayerLine[],
		drop: PlayerLine,
		get: readonly PlayerLine[]
	): { by: PlayerLine; at: number } | null => {
		const next = weekSlots(
			after.filter((l) => l !== drop),
			SLOTS
		);
		if (base.some((l, at) => l !== null && next[at] === null)) return null;
		const starts = get.flatMap((l) => {
			const at = next.indexOf(l);
			return at < 0 ? [] : [{ by: l, at }];
		});
		return starts.find((s) => s.at === spotOf.get(id(drop))) ?? starts[0] ?? null;
	};
	const pick = (row: TradeRow, held: ReadonlySet<string>): TradeRow | null => {
		if (row.drop === null) return { ...row, drop_reason: null };
		const gone = new Set(row.give.map(id));
		const taken = new Set(row.get.map(id));
		const after = [...roster.filter((l) => !gone.has(id(l))), ...row.get];
		const seasonStarts = new Set(seasonStarters(after, SLOTS).map(id));
		const defenses = after.filter((l) => l.player.position === DEFENSE).length;
		const may = after
			.filter(
				(l) =>
					!taken.has(id(l)) &&
					!seasonStarts.has(id(l)) &&
					!l.held &&
					!held.has(l.player.name) &&
					(l.player.position !== DEFENSE || defenses > defenseSlots)
			)
			.sort(cost);
		const bench = may.find((l) => !spotOf.has(id(l)));
		if (bench) return { ...row, drop: bench, drop_reason: null };
		for (const drop of may) {
			const spot = spotOf.get(id(drop));
			const taker = spot === undefined ? null : takes(after, drop, row.get);
			if (spot !== undefined && taker !== null) {
				const reason = dropReason(
					drop,
					taker.by,
					slotLabel(SLOTS, rowOf(drop)),
					slotLabel(SLOTS, taker.at)
				);
				return { ...row, drop, drop_reason: reason };
			}
		}
		return null;
	};
	const standInHeld = new Set<string>([
		...stampedLineup.bench.map((l) => l.player.name),
		...STARTER_DROP_STANDIN.holds
	]);
	return {
		...finder,
		teams: finder.teams.map((team) => ({
			...team,
			trades: team.trades.flatMap((row, i) => {
				const standIn = team.name === STARTER_DROP_STANDIN.team && i === 0;
				const kept = pick(row, standIn ? standInHeld : new Set());
				return kept === null ? [] : [kept];
			})
		}))
	};
}

/** The trade finder as the API now answers it (Lane 66g): the week's opponent's whole roster (the
 * one team the recorded week shows whole, its starters with the finder's rows), each trade's change
 * in this week's Proj for both sides (trades.go WeekProj, by week.ts), the verb's moves rule
 * (hosturls.go TradeMoves) and the projection's read and scoring for the columns' basis. */
function withWeek(finder: TradeAdvice): TradeAdvice {
	const opponent = matchup?.opponent ?? null;
	const teams = finder.teams.map((team) => {
		if (team.roster_id !== opponent?.roster_id) return team;
		const held = new Set(team.roster.map((l) => l.player.host_id));
		const starters = opponent.starters
			.map((s) => byHost.get(s.player.host_id) ?? lineOf(s.player))
			.filter((l) => !held.has(l.player.host_id));
		return { ...team, roster: [...starters, ...team.roster] };
	});
	const change = (
		roster: readonly PlayerLine[],
		out: readonly PlayerLine[],
		into: readonly PlayerLine[]
	): number => {
		const gone = new Set(out.map((l) => l.player.host_id));
		const after = [...roster.filter((l) => !gone.has(l.player.host_id)), ...into];
		return tenth(lineupProj(after, SLOTS) - lineupProj(roster, SLOTS));
	};
	// A team the fixture holds only in part (the players its trades name) cannot set a lineup: its
	// change stands in as the Proj it takes in less the Proj it sends, each as printed.
	const swapOnly = (out: readonly PlayerLine[], into: readonly PlayerLine[]): number => {
		const sum = (lines: readonly PlayerLine[]): number =>
			lines.reduce((s, l) => s + (tierOf(l) === 0 ? (printedProj(l) ?? 0) : 0), 0);
		return tenth(sum(into) - sum(out));
	};
	return {
		...finder,
		teams: teams.map((team) => ({
			...team,
			trades: team.trades.map((row) => ({
				...row,
				my_proj_change: change(
					finder.roster,
					[...row.give, ...(row.drop ? [row.drop] : [])],
					row.get
				),
				their_proj_change:
					team.roster_id === opponent?.roster_id
						? change(team.roster, row.get, row.give)
						: swapOnly(row.get, row.give)
			}))
		})),
		// The finder's basis in the API's words, stamped whole from the one copy (week.ts tradesBases) so a
		// rerun on an older answer says it the same way.
		...tradesBases(weeksCovered(finder.week, STANDARD_HORIZON), STANDARD_HORIZON),
		per_game_basis: PER_GAME_BASIS,
		...uncountedOf(lineup.uncounted_rules),
		check_basis: CHECK_BASIS,
		moves: {
			propose: 'unavailable',
			reason:
				'Sleeper does not take trade proposals from here, so we copy the trade for you to propose there.'
		},
		projection_read_at: PROJECTION_READ_AT,
		projection_scoring: PROJECTION_SCORING,
		player_points: true
	};
}
const stampedTrades = withWeek(followLineup(stampedFinder));

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
