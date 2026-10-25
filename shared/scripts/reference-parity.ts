/** The reference screens' parity (Lane 199): what the web's ADP, Compare, clubs index, club and
 * strength of schedule pages build from a run's files (server/pages/adp.ts, routes/(run)/compare,
 * run/schedule-view.ts), for the two fixture runs the apps read, as JSON their ports are held to.
 *
 * - `adp`: each format's rows in the drafters' order (ranked and market rows with an ADP, earliest
 *   first, our rank breaking ties), each row's ADP, Rk, Gap and tint, the phone's basis, and the
 *   players the drafts have that the board does not (and the board's players with no ADP), neither
 *   of whom the page draws.
 * - `compare`: the first steps, every format's basis, and every pair of the run's pages in every
 *   format: the call and its evidence, the table's rows with their better side and the Gap's tone, and
 *   the basis the table prints (no Gap sentence without a Gap row); a held pair besides.
 * - `clubs`, `clubPages`, `schedule`: the index's lead and cards, each club's hero, games, caption,
 *   rows and basis, and the grid's lead, heads and cells.
 *
 * The run's reach (how far the season's figures go) is counted over the run's own pages, as the
 * site's reader counts it (server/run.ts seasonReach); the schedule's played games are its finals
 * past the complete week (playedReach). Written by export-parity.ts beside the other screens'. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { adpFigure } from '../../web/src/lib/format/draft.ts';
import { EMPTY_FIGURE } from '../../web/src/lib/format/empty.ts';
import { carriesGap, gapText } from '../../web/src/lib/format/gap.ts';
import { fixed, plural } from '../../web/src/lib/format/number.ts';
import { adpDrafts } from '../../web/src/lib/run/adp-drafts.ts';
import { boardBasis } from '../../web/src/lib/run/board-basis.ts';
import { heldOut, withStatuses } from '../../web/src/lib/run/board-status.ts';
import { rankShown } from '../../web/src/lib/run/held-places.ts';
import { MARKET_POSITIONS, marketAt, splitBoard } from '../../web/src/lib/run/market.ts';
import { countedReach, finalsReach, reachWords, type Reach } from '../../web/src/lib/run/reach.ts';
import type { FiguresReach } from '../../web/src/lib/run/rest-words.ts';
import { rowFraming } from '../../web/src/lib/run/row-framing.ts';
import {
	clubCards,
	clubSchedule,
	scheduleGrid,
	strongFloor
} from '../../web/src/lib/run/schedule-view.ts';
import {
	boardSchema,
	clubsSchema,
	designationsSchema,
	latestPointerSchema,
	scheduleSchema,
	type AdpSource,
	type Designations,
	type Format,
	type Manifest,
	type Player,
	type PlayerStatus,
	type Schedule
} from '../../web/src/lib/run/schema.ts';
import { winsBasis } from '../../web/src/lib/run/strength-words.ts';
import { compareRows, type Side } from '../../web/src/lib/site/compare-rows.ts';
import { firstStep } from '../../web/src/lib/site/compare-words.ts';
import type { PlayerData } from '../../web/src/lib/site/player-data.ts';
import { absentWords } from '../../web/src/lib/site/absent.ts';
import { CLUB_PAGE, SCHEDULE_PAGE, filled } from '../../web/src/lib/site/reference-words.ts';
import { verdict } from '../../web/src/lib/site/verdict.ts';
import { heatFor } from '../../web/src/lib/ui/heat.ts';
import { REPOSITORY } from './generated.ts';

export const REFERENCE_OUTPUT = 'shared/fixtures/parity/reference.json';

/** The fixture runs the apps read, and the clock each is shown at (board-run-parity.ts BOARD_RUNS). */
const REFERENCE_RUNS = [
	{ fixture: 'shared/fixtures/standin-run', now: '2026-09-01T17:00:00.000Z' },
	{ fixture: 'shared/fixtures/run', now: '2026-10-22T17:00:00.000Z' }
] as const;

type ReferenceRun = (typeof REFERENCE_RUNS)[number];

/** A season-long status a held pair gives its first side: his rank a word, his call the other's. */
const HELD_STATUS: PlayerStatus = { status: 'injured_reserve', seasonLong: true, since: null };

async function json(path: string): Promise<unknown> {
	return JSON.parse(await readFile(join(REPOSITORY, path), 'utf8'));
}

/** Everything a run's reference pages read, as the site's reader holds it. */
interface RunFiles {
	runId: string;
	manifest: Manifest;
	sources: AdpSource[];
	adpPlayers: Record<string, Record<string, number>>;
	capture: Designations | null;
	clubs: ReturnType<typeof clubsSchema.parse>;
	schedule: Schedule;
	pages: Player[];
}

async function filesOf(run: ReferenceRun): Promise<RunFiles> {
	const { runId } = latestPointerSchema.parse(await json(`${run.fixture}/runs/latest.json`));
	const folder = `${run.fixture}/runs/${runId}`;
	const manifest = (await json(`${folder}/manifest.json`)) as Manifest;
	const adp = (await json(`${folder}/adp.json`)) as {
		sources: AdpSource[];
		players: Record<string, Record<string, number>>;
	};
	const capture = await json(`${folder}/designations.json`);
	const names = (await readdir(join(REPOSITORY, folder, 'players'))).filter((name) =>
		name.endsWith('.json')
	);
	const pages = await Promise.all(
		names.sort().map(async (name) => (await json(`${folder}/players/${name}`)) as Player)
	);
	return {
		runId,
		manifest,
		sources: adp.sources,
		adpPlayers: adp.players,
		// The fixtures carry no source (the API drops it): the schema's provenance is put back to parse.
		capture:
			capture === null
				? null
				: designationsSchema.parse({ source: 'fixture', ...(capture as object) }),
		clubs: clubsSchema.parse(await json(`${folder}/clubs.json`)),
		schedule: scheduleSchema.parse(await json(`${folder}/schedule.json`)),
		pages
	};
}

async function boardOf(run: ReferenceRun, files: RunFiles, format: string) {
	try {
		return splitBoard(
			boardSchema.parse(await json(`${run.fixture}/runs/${files.runId}/boards/${format}.json`))
		);
	} catch {
		return null;
	}
}

/** server/run.ts seasonUnderway: the run was written after the season's first kickoff. */
function underwayOf(files: RunFiles): boolean {
	const kickoffs = files.schedule.slates.flatMap((slate) => slate.games.map((g) => g.kickoff));
	const first = kickoffs.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
	return Date.parse(files.manifest.runAt) >= Date.parse(first);
}

/** server/run.ts seasonReach, over the run's own pages. */
function seasonReachOf(files: RunFiles): { figures: FiguresReach; complete: number } {
	const [first] = files.pages;
	if (!first) throw new Error('The run has no page.');
	const { season } = first;
	const label = files.manifest.formats.find((f) => f.id === season.format)?.label ?? season.format;
	const counted = files.pages.map((page) => ({ ...page.season, team: page.team }));
	const reach = countedReach(counted, files.schedule.slates, season.through);
	return { figures: { scoring: label, through: reachWords(reach) }, complete: season.through };
}

function playedOf(files: RunFiles, underway: boolean): Reach {
	return underway
		? finalsReach(files.schedule.slates, seasonReachOf(files).complete)
		: { complete: 0, partial: null };
}

async function adpCases(run: ReferenceRun, files: RunFiles, underway: boolean) {
	const cases = [];
	for (const format of files.manifest.formats) {
		const board = await boardOf(run, files, format.id);
		if (board === null) continue;
		const ranked = withStatuses(board.rows, files.capture);
		const market = withStatuses(board.market, files.capture);
		const rows = [...ranked, ...market]
			.flatMap((row) => (row.adp === null ? [] : [{ ...row, adp: row.adp }]))
			.sort((a, b) => a.adp - b.adp || a.ourRank - b.ourRank);
		const showsGap = rowFraming(format).compare && carriesGap(rows);
		const onBoard = new Set([...board.rows, ...board.market].map((row) => row.id));
		const source = files.sources.find((s) => s.formats.includes(format.id));
		cases.push({
			format: format.id,
			gap: showsGap,
			rows: rows.map((row) => {
				const isMarket = row.orderBasis === 'market';
				const held = heldOut(row);
				return {
					id: row.id,
					adp: adpFigure(row.adp),
					rank: isMarket ? EMPTY_FIGURE : rankShown(row),
					gap: gapText(isMarket || held ? null : (row.gap ?? null)),
					heat: isMarket ? null : heatFor(row.vor, row.vorRound)
				};
			}),
			basis: boardBasis({
				format,
				season: files.manifest.season,
				order: 'adp',
				adpBasis: adpDrafts(files.sources, format.id),
				gap: showsGap,
				reach: underway ? seasonReachOf(files).figures : null,
				noAdp: board.rows.filter((row) => row.adp === null).length
			})
				.filter((part) => part.phone)
				.map((part) => part.text),
			sourcesOnly:
				source === undefined
					? []
					: Object.entries(files.adpPlayers)
							.filter(([id, figures]) => figures[source.id] !== undefined && !onBoard.has(id))
							.map(([id]) => id)
							.sort(),
			noAdp: board.rows.filter((row) => row.adp === null).map((row) => row.id)
		});
	}
	return cases;
}

/** routes/data/players/[id].json: the page's numbers, his status, his season and last season's. */
function playerData(files: RunFiles, page: Player, status?: PlayerStatus): PlayerData {
	const captured = status ?? files.capture?.players[page.id];
	const last = (page.priorSeasons ?? []).find(
		(prior) => prior.season === files.manifest.season - 1
	);
	return {
		id: page.id,
		slug: page.slug,
		name: page.name,
		position: page.position,
		team: page.team,
		headshot: page.headshot,
		formats: page.formats,
		...(captured === undefined ? {} : { status: captured }),
		seasonSoFar: { games: page.season.games, pointsPerGame: page.season.pointsPerGame },
		...(last === undefined
			? {}
			: { lastSeason: { season: last.season, games: last.games, pointsPerGame: last.pointsPerGame } })
	};
}

/** routes/(run)/compare/+page.server.ts: each format's basis, the last season's line after it. */
function compareBasis(files: RunFiles, format: Format, underway: boolean) {
	return [
		...boardBasis({
			format,
			season: files.manifest.season,
			order: 'board',
			adpBasis: adpDrafts(files.sources, format.id),
			gap: rowFraming(format).compare,
			reach: underway ? seasonReachOf(files).figures : null
		}).map((part) => ({ text: part.text, gap: part.topic === 'gap' })),
		{ text: `${String(files.manifest.season - 1)} a game is last season's points a game.`, gap: false }
	];
}

function pairCase(
	files: RunFiles,
	format: Format,
	underway: boolean,
	a: PlayerData,
	b: PlayerData
) {
	const byes = new Map(files.clubs.map((club) => [club.abbr, club.bye]));
	const sideOf = (player: PlayerData): Side | null => {
		const numbers = player.formats[format.id];
		return numbers ? { player, numbers, bye: byes.get(player.team) ?? null } : null;
	};
	const first = sideOf(a);
	const second = sideOf(b);
	if (!first || !second) return null;
	const contender = (side: Side) => ({
		id: side.player.id,
		name: side.player.name,
		ourRank: side.numbers.ourRank,
		vor: side.numbers.vor,
		held: side.player.status?.seasonLong === true ? side.player.status.status : null,
		side
	});
	const call = verdict(contender(first), contender(second), format.label);
	if (call.kind === 'same') return { a: a.id, b: b.id, format: format.id, kind: 'same' };
	const rows = compareRows(call.leader.side, call.other.side, files.manifest.season, underway);
	const basis = compareBasis(files, format, underway);
	const showsGap = rows.some((row) => row.label === 'Gap');
	return {
		a: a.id,
		b: b.id,
		format: format.id,
		kind: 'call',
		leader: call.leader.id,
		call: call.call,
		evidence: call.evidence,
		rows: rows.map((row) => ({
			label: row.label,
			range: row.range === true,
			cells: row.cells.map((cell) => ({
				text: cell.text,
				wins: cell.wins,
				tone: cell.tone ?? null
			}))
		})),
		basis: basis.filter((part) => showsGap || !part.gap).map((part) => part.text)
	};
}

function compareCases(files: RunFiles, underway: boolean) {
	const players = files.pages.map((page) => playerData(files, page));
	const pairs = [];
	for (const format of files.manifest.formats) {
		for (const a of players) {
			for (const b of players) {
				const found = pairCase(files, format, underway, a, b);
				if (found !== null && (a.id !== b.id || a === players[0])) pairs.push(found);
			}
		}
	}
	const [heldPage, otherPage] = files.pages;
	const held =
		heldPage && otherPage
			? files.manifest.formats.flatMap((format) => {
					const found = pairCase(
						files,
						format,
						underway,
						playerData(files, heldPage, HELD_STATUS),
						playerData(files, otherPage)
					);
					return found === null ? [] : [{ ...found, held: heldPage.id }];
				})
			: [];
	return {
		steps: { none: firstStep(0), one: firstStep(1) },
		basis: Object.fromEntries(
			files.manifest.formats.map((format) => [
				format.id,
				compareBasis(files, format, underway).map((part) => part.text)
			])
		),
		pairs,
		held
	};
}

async function clubCases(
	run: ReferenceRun,
	files: RunFiles,
	underway: boolean,
	played: Reach
) {
	const [format] = files.manifest.formats;
	if (format === undefined) throw new Error(`${run.fixture} carries no format.`);
	const board = await boardOf(run, files, format.id);
	if (board === null) throw new Error(`${run.fixture} has no ${format.id} board.`);
	const ordered = withStatuses(board.rows, files.capture);
	const cards = clubCards(files.clubs, files.schedule, ordered, format.label, underway);
	const names = new Map(files.clubs.map((club) => [club.abbr, `${club.city} ${club.nickname}`]));
	const showsGapOf = (rows: typeof ordered) => rowFraming(format).compare && carriesGap(rows);
	return {
		clubs: {
			lead: cards.lead,
			clubs: cards.clubs.map((club) => ({
				abbr: club.abbr,
				name: `${club.city} ${club.nickname}`,
				meta: `${club.abbr} · ${CLUB_PAGE.byeWeek} ${club.bye === null ? CLUB_PAGE.byeNotSet : String(club.bye)}`,
				strength: club.strength,
				lead: club.lead?.id ?? null,
				players: `${plural(club.players, CLUB_PAGE.player)} ${CLUB_PAGE.onOurBoard}`
			}))
		},
		clubPages: files.clubs.map((club) => {
			const own = ordered.filter((row) => row.team === club.abbr);
			// His kickers and his defense, in draft order (server/pages/clubs.ts clubPage).
			const market = MARKET_POSITIONS.flatMap((position) =>
				withStatuses(marketAt(board.market, position), files.capture).filter(
					(row) => row.team === club.abbr
				)
			);
			const scheduled = clubSchedule(club, files.schedule, played, underway);
			const gap = showsGapOf(own);
			return {
				abbr: club.abbr,
				hero: scheduled.hero,
				scheduleCaption: scheduled.scheduleCaption,
				games: scheduled.games.map((game) => ({
					week: game.week,
					opponent: `${game.home ? CLUB_PAGE.home : CLUB_PAGE.away} ${names.get(game.opponent) ?? game.opponent}`,
					value: fixed(game.value, 1),
					played: game.played
				})),
				rows: own.map((row) => row.id),
				market: market.map((row) => row.id),
				gap,
				pair: own
					.filter((row) => !heldOut(row))
					.slice(0, 2)
					.map((row) => row.id),
				basis: [
					winsBasis(files.schedule.opponentBasis),
					...boardBasis({
						format,
						season: files.manifest.season,
						order: 'board',
						adpBasis: adpDrafts(files.sources, format.id),
						gap,
						reach: underway ? seasonReachOf(files).figures : null
					})
						.filter((part) => part.phone)
						.map((part) => part.text)
				]
			};
		}),
		schedule: {
			...scheduleGrid(files.schedule, files.clubs, board.rows, played, underway),
			legendHard: filled(
				SCHEDULE_PAGE.legendHard,
				fixed(strongFloor(Object.values(files.schedule.opponentValues)).floor, 1)
			)
		}
	};
}

async function runCase(run: ReferenceRun) {
	const files = await filesOf(run);
	const underway = underwayOf(files);
	const played = playedOf(files, underway);
	return {
		fixture: run.fixture,
		runId: files.runId,
		now: run.now,
		underway,
		played,
		adp: await adpCases(run, files, underway),
		compare: compareCases(files, underway),
		...(await clubCases(run, files, underway, played))
	};
}

export async function renderReference(about: string): Promise<string> {
	const runs = [];
	for (const run of REFERENCE_RUNS) runs.push(await runCase(run));
	const absent = absentWords('Half PPR', '', ['PPR']).title;
	return `${JSON.stringify({ about, absent, runs }, null, '\t')}\n`;
}
