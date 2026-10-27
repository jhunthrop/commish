/** One value and one order for a player on the apps' in-season screens (Lane 224, B207, the apps'
 * follow of Lane 220's web rule, web/src/lib/run/live-order.ts and player/live-figures.ts): what the
 * web prints for three players (an RB whose game has kicked off, a WR whose game is final, a QB on
 * bye) on every view that ranks or scores them, once the order the in-season pages read has answered and
 * while it has not, as JSON the apps' ports are held to; and the stand-in run those views are built
 * from, in the run routes' layout, for the apps' tests and snapshots.
 *
 * STAND-IN, named so: no fixture run holds the order's players (the contract run has four others),
 * so `shared/fixtures/one-value-run` is made here from the fixture order. Its PPR board is the
 * Saturday order's whole read (order-all-2026-10-17T17-00-00Z, every week 6 game still to come, the
 * byes in their places) placed one lower
 * than the order, as a run made before a kickoff ranks a player the read has since moved past
 * (Lane 220's one-value.test.ts did the same); its manifest, clubs, schedule and ADP are the contract
 * run's, made Thursday Oct 15 before week 6 (the order's from_week). The three players' pages carry
 * that row in PPR and its figures scaled by the contract run's own Half PPR and Standard ratios in the
 * other two formats (`FORMAT_SCALE`), and their weeks (GET /players/{id}/week) are the Sunday order's
 * line with the rest-of-season figures the same scaling gives at the read's clock. Every rank and
 * figure the views print at the read's clock is the Sunday order's whole read (order-all-
 * 2026-10-18T18-56-00Z): the web's live-order-read.ts and the apps' OrderReader keep the byes in their
 * places, so a bye club's players are within the API's 400 rows (Lane 224 review H1).
 *
 * Written by export-parity.ts beside the others. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { components } from '../../web/src/lib/api/types.ts';
import {
	answerReadAt,
	inSeasonStamp,
	liveLeadPart,
	shapeWords
} from '../../web/src/lib/front/live-board.ts';
import { FORMATS_RANK } from '../../web/src/lib/player/formats-words.ts';
import { lineFiguresAt, lineRanksAt } from '../../web/src/lib/player/live-figures.ts';
import type { BasisPart } from '../../web/src/lib/run/board-basis.ts';
import { leadOf } from '../../web/src/lib/run/held-places.ts';
import {
	LIVE_ORDER_WORDS,
	basisAtClock,
	inScoring,
	livePlaces,
	placedAt,
	placedLeads,
	placedPair,
	placedRows,
	type LivePlace
} from '../../web/src/lib/run/live-order.ts';
import { verdict } from '../../web/src/lib/site/verdict.ts';
import type { BoardFormat } from '../../web/src/lib/sheet/model.ts';
import { REPOSITORY } from './generated.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = OrderAdvice['rows'][number];

export const ONE_VALUE_OUTPUT = 'shared/fixtures/parity/one-value.json';
/** The stand-in run's folder, the bucket's layout: `runs/latest.json` and `runs/<runId>/`. */
export const ONE_VALUE_RUN = 'shared/fixtures/one-value-run';
/** The three players' weeks as GET /players/{id}/week answers them, beside the run. */
const WEEKS = `${ONE_VALUE_RUN}/weeks`;
const CONTRACT_RUN = 'shared/fixtures/run/runs/2026-10-21T12-ros';
const INSEASON = 'shared/fixtures/inseason';

/** The fixture's zone: its clocks are named on Central time (shared/fixtures/README.md). */
const ZONE = 'America/Chicago';
/** The stand-in run: made Thursday Oct 15, 8:50 am Central, before week 6's first kickoff. */
export const ONE_VALUE_RUN_ID = '2026-10-15T13-onevalue';
const RUN_AT = '2026-10-15T13:50:00.000Z';
/** The week the run ranks from, and the last week its season figures count. */
const FROM_WEEK = 6;
const THROUGH_WEEK = FROM_WEEK - 1;
/** The regular season's last week the run's rest of season counts through. */
const LAST_WEEK = 17;
/** The orders read at the fixture clocks: the run's rows from Saturday's, the views at Sunday's. */
const SATURDAY = '2026-10-17T17-00-00Z';
export const SUNDAY = '2026-10-18T18-56-00Z';
const SUNDAY_AT = '2026-10-18T18:56:00.000Z';
/** The board's size, as the public order values it (format-ids.ts DEFAULT_TEAMS). */
const TEAMS = 12;
/** The stand-in's places: one below the order's, its Over repl. one higher. */
const RUN_OFFSET = 1;
/** The players the parity names: the brief's three positions, each a game state of week 6. */
export const PLAYERS = ["D'Andre Swift", 'Parker Washington', 'Joe Burrow'] as const;
/** The contract run's page the stand-in pages are shaped from (its season block and its keys). */
const PAGE_TEMPLATE = '4429795';
/** The run's formats in the manifest's order: the PPR board, then the two the pages scale to. */
const FORMATS = [
	{ id: 'ppr-12', api: 'ppr', label: 'PPR' },
	{ id: 'half-ppr-12', api: 'half_ppr', label: 'Half PPR' },
	{ id: 'standard-12', api: 'standard', label: 'Standard' }
] as const;
type FormatId = (typeof FORMATS)[number]['id'];
/** STAND-IN: each format's figures as a share of PPR's, the contract run's own ratio for its
 * template page (Half PPR 223.7 and Standard 193.7 against PPR 242.5). */
const FORMAT_SCALE: Readonly<Record<FormatId, number>> = {
	'ppr-12': 1,
	'half-ppr-12': 0.9226,
	'standard-12': 0.7986
};
/** The game states his own rest of season starts after: a game kicked off counts from the next week. */
const STARTED = new Set(['kicked_off', 'final']);
/** The live run's board against one read (Lane 224 report): 400 of 627. */
const REACH_SAMPLE = { shown: 400, total: 627 } as const;
/** A club card's pool, its first players on the board (server/pages/clubs.ts CLUB_LEAD_POOL). */
const CLUB_LEAD_POOL = 3;

type Json = Record<string, unknown>;

/** A board row of the stand-in run, as boards/<format>.json writes it. */
interface RunRow {
	id: string;
	slug: string;
	name: string;
	position: string;
	positionRank: number;
	team: string;
	headshot: string;
	ourRank: number;
	vorRound: number;
	adp: number | null;
	gap: number | null;
	projected: number;
	vor: number;
	expectedGames: number;
	floor: null;
	median: null;
	ceiling: null;
	tier: number;
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(join(REPOSITORY, path), 'utf8')) as T;
}

async function order(clock: string): Promise<OrderAdvice> {
	return (await readJson<{ data: OrderAdvice }>(`${INSEASON}/order-all-${clock}.json`)).data;
}

/** A tenth as the run's figures round, so the apps read the same number the web does. */
const tenth = (value: number): number => Math.round(value * 10) / 10;

/** A row the order places with both figures and a board id. */
function placed(row: OrderRow): boolean {
	return (
		row.line.player.board_id !== null &&
		row.line.position_rank !== null &&
		row.rest_of_season_points !== null &&
		row.points_over_replacement !== null
	);
}

/** Each position's tier on the stand-in: six players to a tier, as no fit draws them here. */
const TIER_SIZE = 6;

/** Saturday's row as the stand-in run's board row: the run's figures, placed one lower. */
function runRow(row: OrderRow): RunRow {
	const rank = row.rank + RUN_OFFSET;
	const positionRank = (row.line.position_rank ?? 0) + RUN_OFFSET;
	return {
		id: row.line.player.board_id ?? '',
		slug: row.line.slug ?? '',
		name: row.line.player.name,
		position: row.line.player.position,
		positionRank,
		team: row.line.player.team,
		headshot: row.line.headshot ?? '',
		ourRank: rank,
		vorRound: Math.ceil(rank / TEAMS),
		adp: null,
		gap: null,
		projected: row.rest_of_season_points ?? 0,
		vor: tenth((row.points_over_replacement ?? 0) + RUN_OFFSET),
		expectedGames: LAST_WEEK - FROM_WEEK,
		floor: null,
		median: null,
		ceiling: null,
		tier: Math.ceil(positionRank / TIER_SIZE)
	};
}

/** The stand-in's rows: Saturday's placed rows the Sunday order places too, in Saturday's order. */
function runRows(saturday: OrderAdvice, sunday: OrderAdvice): RunRow[] {
	const kept = new Set(
		sunday.rows.filter(placed).map((row) => row.line.player.board_id ?? '')
	);
	return saturday.rows
		.filter((row) => placed(row) && kept.has(row.line.player.board_id ?? ''))
		.map(runRow);
}

function named(rows: readonly RunRow[], name: string): RunRow {
	const row = rows.find((candidate) => candidate.name === name);
	if (row === undefined) throw new Error(`The stand-in run has no ${name}.`);
	return row;
}

function orderRowOf(answer: OrderAdvice, id: string): OrderRow {
	const row = answer.rows.find((candidate) => candidate.line.player.board_id === id);
	if (row === undefined) throw new Error(`The order has no ${id}.`);
	return row;
}

/** The fields every view prints of a placed row. */
function shown(row: Pick<RunRow, 'ourRank' | 'positionRank' | 'projected' | 'vor' | 'vorRound'>): Json {
	return {
		rank: row.ourRank,
		positionRank: row.positionRank,
		projected: row.projected,
		vor: row.vor,
		round: row.vorRound
	};
}

/** His week's rest-of-season figures at the read's clock, every format scaled from the order's. */
function restOfSeason(row: OrderRow): Json[] {
	return FORMATS.map((format) => ({
		format: format.api,
		points: tenth((row.rest_of_season_points ?? 0) * FORMAT_SCALE[format.id]),
		points_over_replacement: tenth((row.points_over_replacement ?? 0) * FORMAT_SCALE[format.id])
	}));
}

/** His own first week at the read's clock: the next one once his game of the order's week started. */
function restFrom(row: OrderRow): number {
	const state = row.line.facts.game_state ?? null;
	return state !== null && STARTED.has(state) ? FROM_WEEK + 1 : FROM_WEEK;
}

/** The every-format table for him (player/live-figures.ts): each format's run rank and figures, and
 * at the read the PPR line's rank the head's, the others none with the one footnote. */
function formatsTable(row: RunRow, week: OrderRow, live: boolean): Json {
	const lines = FORMATS.map((format) => ({
		run: row.positionRank,
		format: format.api as BoardFormat,
		label: format.label
	}));
	const figures = live
		? {
				head: 'Rest of season',
				// The apps' formats table reads no per-format ranks yet (Lanes 226 and 232 port Lane 234's),
				// so the parity models a read without them: the read's own format carries his place.
				ranks: null,
				figures: Object.fromEntries(
					restOfSeason(week).map((figure) => [
						figure.format,
						{ points: figure.points, vor: figure.points_over_replacement }
					])
				)
			}
		: null;
	const read = live ? { format: 'ppr' as BoardFormat, positionRank: week.line.position_rank } : null;
	const ranks = lineRanksAt(lines, figures, read, false);
	return {
		rows: FORMATS.map((format, i) => {
			const run = { points: scaled(row, format.id).projected, vor: scaled(row, format.id).vor };
			const at = lineFiguresAt(run, format.api, figures);
			return { format: format.id, rank: ranks.ranks[i], points: at.points, vor: at.vor };
		}),
		footnote: ranks.unranked.length === 0 ? null : FORMATS_RANK.unranked(ranks.unranked, ranks.reason)
	};
}

/** A club card's lead from its pool, at the read's clock or the run's. */
function clubLeads(
	rows: readonly RunRow[],
	places: ReadonlyMap<string, LivePlace> | null,
	clubs: readonly string[]
): Json[] {
	const cards = clubs.map((abbr) => {
		const pool = rows.filter((row) => row.team === abbr).slice(0, CLUB_LEAD_POOL);
		return { abbr, lead: leadOf(pool), pool };
	});
	const shownCards = places === null ? cards : placedLeads(cards, places, TEAMS);
	if (shownCards === null) throw new Error('The order places every club pool of the stand-in.');
	return shownCards.map((card) => ({
		abbr: card.abbr,
		lead: card.lead === null ? null : { id: card.lead.id, ...shown(card.lead) }
	}));
}

/** The pair Compare draws for the first two players in a format: the order's when it places both in
 * the board's format, else the run's, with our call's evidence. */
function comparePair(
	rows: readonly RunRow[],
	places: ReadonlyMap<string, LivePlace> | null,
	format: FormatId
): Json {
	const pair = PLAYERS.slice(0, 2).map((name) => scaled(named(rows, name), format));
	const at = placedPair(
		pair.map((row) => row.id),
		places,
		format,
		FORMATS[0].id
	);
	const sides = pair.map((row) => {
		const place = at?.get(row.id);
		return place === undefined ? row : placedAt(row, place, TEAMS);
	});
	const [first, second] = sides;
	if (first === undefined || second === undefined) throw new Error('Compare needs two sides.');
	const label = FORMATS.find((candidate) => candidate.id === format)?.label ?? '';
	const call = verdict(first, second, label);
	return {
		format,
		atClock: at !== null,
		sides: sides.map((side) => ({ id: side.id, ...shown(side), gap: side.gap })),
		evidence: call.kind === 'call' ? call.evidence : null
	};
}

/** Each view at the read's clock for one player, and the run's before it answers. */
function playerViews(
	name: string,
	rows: readonly RunRow[],
	sunday: OrderAdvice,
	places: ReadonlyMap<string, LivePlace>
): Json {
	const row = named(rows, name);
	const week = orderRowOf(sunday, row.id);
	const board = placedRows(rows, places, TEAMS);
	const club = placedRows(
		rows.filter((candidate) => candidate.team === row.team),
		places,
		TEAMS
	);
	const place = places.get(row.id);
	if (board === null || club === null || place === undefined) {
		throw new Error(`The order places every row ${name} is drawn among.`);
	}
	const at = (list: readonly RunRow[]): Json => {
		const found = list.find((candidate) => candidate.id === row.id);
		if (found === undefined) throw new Error(`${name} is not drawn.`);
		return { row: list.indexOf(found), ...shown(found) };
	};
	return {
		name,
		id: row.id,
		slug: row.slug,
		team: row.team,
		position: row.position,
		order: {
			rank: week.rank,
			positionRank: week.line.position_rank,
			projected: week.rest_of_season_points,
			vor: week.points_over_replacement
		},
		run: shown(row),
		board: at(board),
		club: { ids: club.map((candidate) => candidate.id), ...at(club) },
		compare: shown(placedAt(row, place, TEAMS)),
		formats: { run: formatsTable(row, week, false), read: formatsTable(row, week, true) },
		restFromWeek: restFrom(week)
	};
}

/** The basis on each clock: the run's board sentence with the run's stamp after the whole basis, or
 * the order's lead in that sentence's place (basisAtClock). */
function bases(sunday: OrderAdvice): Json {
	const lead = liveLeadPart(
		sunday,
		shapeWords(TEAMS, false),
		answerReadAt(sunday, Date.parse(SUNDAY_AT)),
		ZONE
	);
	const stamp = inSeasonStamp({ rosFromWeek: FROM_WEEK, refreshedAt: RUN_AT }, ZONE);
	const runBasis: BasisPart[] = [
		{ text: 'Wins basis.', phone: true },
		{ text: 'Our board sentence.', phone: true, topic: 'board' },
		{ text: 'Capture sentence.', phone: true }
	];
	const texts = (parts: readonly BasisPart[]): string[] => parts.map((part) => part.text);
	return {
		lead: lead.text,
		stamp: stamp?.text ?? null,
		// The Board's count when one read reaches fewer players than it ranks (the live run's 627).
		reach: { shown: REACH_SAMPLE.shown, total: REACH_SAMPLE.total, text: LIVE_ORDER_WORDS.reach(REACH_SAMPLE.shown, REACH_SAMPLE.total) },
		sample: texts(runBasis),
		unread: texts(basisAtClock(runBasis, null, stamp)),
		read: texts(basisAtClock(runBasis, lead, stamp)),
		// A page whose basis names no board (the clubs index): the lead alone, or the stamp alone.
		bare: { unread: texts(basisAtClock([], null, stamp)), read: texts(basisAtClock([], lead, stamp)) }
	};
}

/** A run row in a format: its PPR figures scaled to the format's (the stand-in's pages carry them). */
function scaled(row: RunRow, format: FormatId): RunRow {
	return {
		...row,
		projected: tenth(row.projected * FORMAT_SCALE[format]),
		vor: tenth(row.vor * FORMAT_SCALE[format])
	};
}

/** The parity: the three players on every view, the pair, the refusals and the bases; `clubs` the
 * run's clubs, whose cards the index draws. */
function renderParity(
	about: string,
	rows: readonly RunRow[],
	sunday: OrderAdvice,
	clubs: readonly string[]
): string {
	const places = livePlaces(sunday);
	const unplaced = new Map([...places].filter(([id]) => id !== named(rows, PLAYERS[0]).id));
	const swift = named(rows, PLAYERS[0]);
	const parity = {
		about,
		clock: SUNDAY_AT,
		runAt: RUN_AT,
		zone: ZONE,
		teams: TEAMS,
		order: `${INSEASON}/order-all-${SUNDAY}.json`,
		run: `${ONE_VALUE_RUN}/runs/${ONE_VALUE_RUN_ID}/boards/${FORMATS[0].id}.json`,
		players: PLAYERS.map((name) => playerViews(name, rows, sunday, places)),
		board: { ids: placedRows(rows, places, TEAMS)?.map((row) => row.id) ?? null },
		clubs: { run: clubLeads(rows, null, clubs), read: clubLeads(rows, places, clubs) },
		compare: {
			run: comparePair(rows, null, FORMATS[0].id),
			read: comparePair(rows, places, FORMATS[0].id),
			otherFormat: comparePair(rows, places, FORMATS[1].id)
		},
		refused: {
			// A club the answer does not wholly place keeps the run's rows, every one.
			club: placedRows(
				rows.filter((row) => row.team === swift.team),
				unplaced,
				TEAMS
			),
			pair: placedPair(
				PLAYERS.slice(0, 2).map((name) => named(rows, name).id),
				unplaced,
				FORMATS[0].id,
				FORMATS[0].id
			),
			inScoring: Object.fromEntries(
				FORMATS.map((format) => [format.api, inScoring(sunday, format.api as BoardFormat)])
			)
		},
		basis: bases(sunday)
	};
	return `${JSON.stringify(parity, null, '\t')}\n`;
}

/** The contract run's manifest as the stand-in's: its run, its instant and every format's weeks. */
function manifestOf(contract: Json, players: number): Json {
	const formats = (contract.formats as Json[]).map((format) => ({
		...format,
		basis: (format.basis as string[]).map((line) =>
			line
				.replace(/from week \d+/, `from week ${String(FROM_WEEK)}`)
				.replace(/refreshed [A-Z][a-z]+ \d+/, 'refreshed October 15')
		),
		rosFromWeek: FROM_WEEK,
		rosThroughWeek: THROUGH_WEEK,
		refreshedAt: RUN_AT
	}));
	const reach = { ...(contract.reach as Json), through: `through week ${String(THROUGH_WEEK)}` };
	return {
		...contract,
		runId: ONE_VALUE_RUN_ID,
		runAt: RUN_AT,
		formats,
		players,
		reach: { ...reach, complete: THROUGH_WEEK }
	};
}

/** A stand-in page: the template's keys and season, his identity, his row in every format. */
function pageOf(template: Json, row: RunRow, week: OrderRow): Json {
	const formats = Object.fromEntries(
		FORMATS.map((format) => [
			format.id,
			{
				positionRank: row.positionRank,
				ourRank: row.ourRank,
				vorRound: row.vorRound,
				adp: null,
				projected: scaled(row, format.id).projected,
				vor: scaled(row, format.id).vor,
				expectedGames: row.expectedGames,
				floor: null,
				median: null,
				ceiling: null,
				tier: row.tier
			}
		])
	);
	const season = template.season as Json;
	return {
		...template,
		id: row.id,
		slug: row.slug,
		name: row.name,
		position: row.position,
		team: row.team,
		headshot: row.headshot,
		formats,
		capsule: null,
		season: {
			...season,
			through: THROUGH_WEEK,
			pointsPerGame: week.line.season_avg ?? null
		}
	};
}

/** His week as GET /players/{id}/week answers it at the read's clock: the order's line for him. */
function weekOf(sunday: OrderAdvice, row: OrderRow): string {
	const week = {
		week: sunday.week,
		line: row.line,
		after_bye: null,
		projection_scoring: sunday.projection_scoring,
		projection_read_at: sunday.projection_read_at,
		projection_previous_read_at: null,
		verb: null,
		rest_of_season: restOfSeason(row),
		rest_from_week: restFrom(row)
	};
	return `${JSON.stringify({ ok: true, data: week, error: null, request_id: 'fixture' }, null, '\t')}\n`;
}

const pretty = (value: unknown): string => `${JSON.stringify(value, null, '\t')}\n`;

/** The stand-in run's files and the three weeks, each at its repository path. */
async function renderRun(rows: readonly RunRow[], sunday: OrderAdvice): Promise<[string, string][]> {
	const folder = `${ONE_VALUE_RUN}/runs/${ONE_VALUE_RUN_ID}`;
	const contract = await readJson<Json>(`${CONTRACT_RUN}/manifest.json`);
	const template = await readJson<Json>(`${CONTRACT_RUN}/players/${PAGE_TEMPLATE}.json`);
	const copied = ['adp.json', 'clubs.json', 'schedule.json'];
	const files: [string, string][] = [
		[`${ONE_VALUE_RUN}/runs/latest.json`, pretty({ runId: ONE_VALUE_RUN_ID })],
		[`${folder}/manifest.json`, pretty(manifestOf(contract, rows.length))],
		[`${folder}/boards/${FORMATS[0].id}.json`, pretty({ format: FORMATS[0].id, rows })],
		// The capture names none of the stand-in's players: every one of them is available.
		[
			`${folder}/designations.json`,
			pretty({ ...(await readJson<Json>(`${CONTRACT_RUN}/designations.json`)), players: {} })
		]
	];
	for (const file of copied) {
		files.push([`${folder}/${file}`, pretty(await readJson<unknown>(`${CONTRACT_RUN}/${file}`))]);
	}
	for (const name of PLAYERS) {
		const row = named(rows, name);
		const week = orderRowOf(sunday, row.id);
		files.push([`${folder}/players/${row.id}.json`, pretty(pageOf(template, row, week))]);
		files.push([`${WEEKS}/player-${row.id}-${SUNDAY}.json`, weekOf(sunday, week)]);
	}
	return files;
}

/** Every file this writes: the parity, then the stand-in run and the weeks. */
export async function renderOneValue(about: string): Promise<[string, string][]> {
	const [saturday, sunday] = await Promise.all([order(SATURDAY), order(SUNDAY)]);
	const rows = runRows(saturday, sunday);
	const clubs = (await readJson<{ abbr: string }[]>(`${CONTRACT_RUN}/clubs.json`)).map((club) => club.abbr);
	return [
		[ONE_VALUE_OUTPUT, renderParity(about, rows, sunday, clubs)],
		...(await renderRun(rows, sunday))
	];
}
