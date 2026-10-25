/** The player sheet's and the player page's parity (Lane 192): what the web's player shelf
 * (PlayerShelf.svelte over week-read.ts, status-held.ts, card.ts, shelf.ts and week-words.ts) and its
 * player page (server/pages/player.ts and its words) print, as JSON the apps' ports are held to.
 *
 * - `weekRead`, `noRead`, `statusHeld` and `nextPass`: every held-read case of the web's own tests
 *   (week-read.test.ts and status-held.test.ts), the read, the card's projection and the clock in, the
 *   words shown out.
 * - `sheets`: each sheet player (sheet-players.ts) at each sheet clock, his stand-in page
 *   (shared/fixtures/standin-run) and the fixture API's week for him (shared/fixtures/inseason) in,
 *   the shelf's week head, its game cell, its tiles (label, value and tone: the figures as cells), its
 *   basis lines and the read as the shelf shows it out; once on the stand-in's preseason board and once
 *   on the contract run's rest-of-season format, so both forms of the Rest of season tile are held.
 * - `pages`: each page of both fixture runs, the page's sentences for his leading format (lineWords),
 *   his club's name, the read's stamp, the figures beside the read, the held tier and whether the run
 *   is under way.
 * - `verbs`: the league verb's words for every kind on every platform (week-words.ts verbOf, heldVerb).
 *
 * Written by export-parity.ts beside the other screens' parity. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dayLabel, windowLabel } from '../../web/src/lib/format/date.ts';
import { fixed } from '../../web/src/lib/format/number.ts';
import { rowStatus } from '../../web/src/lib/league/box/box.ts';
import { lineState } from '../../web/src/lib/league/box/kickoff.ts';
import type { PlayerLine } from '../../web/src/lib/league/inseason/api.ts';
import { builtTiles } from '../../web/src/lib/player/card-source.ts';
import { CARD } from '../../web/src/lib/player/card.ts';
import { gameTiles } from '../../web/src/lib/player/shelf.ts';
import { nextHourlyPass, readAtStatus } from '../../web/src/lib/player/status-held.ts';
import {
	noReadWords,
	shownWeekRead,
	type CardProjection,
	type ReadGameState,
	type ShownRead
} from '../../web/src/lib/player/week-read.ts';
import {
	heldVerb,
	liveCard,
	verbOf,
	type CardLeague,
	type PlayerWeek
} from '../../web/src/lib/player/week-words.ts';
import { heldTierWords, lineWords, restFigures } from '../../web/src/lib/run/player-words.ts';
import { readFigures } from '../../web/src/lib/run/read-figures.ts';
import {
	adpSchema,
	boardSchema,
	clubsSchema,
	designationsSchema,
	latestPointerSchema,
	manifestSchema,
	playerSchema,
	scheduleSchema,
	weekReadSchema,
	type Designations,
	type Format,
	type Player,
	type WeekRead
} from '../../web/src/lib/run/schema.ts';
import { cardBuild, restParts, restTile } from '../../web/src/lib/server/pages/player-card.ts';
import { REPOSITORY } from './generated.ts';
import { SHEET_CLOCKS } from './export-fixtures.ts';
import { PUBLIC_SHEET_PLAYER_IDS, SHEET_PLAYER_IDS } from './sheet-players.ts';

export const PLAYER_SHEET_OUTPUT = 'shared/fixtures/parity/player-sheet.json';

/** The fixtures' zone: their clocks are named on Central time (shared/fixtures/README.md). */
const ZONE = 'America/Chicago';
const LEAGUE = '6f1d1c52-2626-4a26-9a26-000000000026';
const FIXTURES = join(REPOSITORY, 'shared/fixtures');
/** The two fixture runs by their folder: the stand-in (the sheet players' pages, its preseason board)
 * and the contract run (in season, the rest of the season from week 7). */
const RUNS = { standin: 'standin-run', contract: 'run' } as const;
type RunName = keyof typeof RUNS;
/** The fixture clocks by name (web/scripts/inseason-fixture/clock.ts), as the fixture files name them. */
const CLOCKS: Readonly<Record<(typeof SHEET_CLOCKS)[number], string>> = {
	week: '2026-10-17T17:00:00.000Z',
	sunday: '2026-10-18T18:56:00.000Z',
	monday: '2026-10-19T16:00:00.000Z'
};

/** An instant as a fixture file names it: `2026-10-17T17-00-00Z`. */
function clockPart(iso: string): string {
	return new Date(Date.parse(iso))
		.toISOString()
		.replace(/\.\d{3}Z$/, 'Z')
		.replace(/:/g, '-');
}

async function json(path: string): Promise<unknown> {
	return JSON.parse(await readFile(join(FIXTURES, path), 'utf8'));
}

/** A run's manifest as a recording keeps it: its provenance is never sent (the API drops it). */
const recordedManifestSchema = manifestSchema.omit({ sources: true });
type RecordedManifest = ReturnType<typeof recordedManifestSchema.parse>;

/** A fixture run's files as the web's reader parses them. */
interface Run {
	name: RunName;
	manifest: RecordedManifest;
	capture: Designations | null;
	adp: ReturnType<typeof adpSchema.parse>;
	clubs: ReturnType<typeof clubsSchema.parse>;
	firstKickoff: string;
	boardSizes: Readonly<Record<string, number>>;
	page: (id: string) => Promise<Player>;
}

/** The run's capture, its provenance put back to parse where the recording dropped it. */
function captureOf(read: unknown): Designations | null {
	return read === null
		? null
		: designationsSchema.parse({ source: 'fixture', ...(read as object) });
}

async function runOf(name: RunName): Promise<Run> {
	const folder = RUNS[name];
	const { runId } = latestPointerSchema.parse(await json(`${folder}/runs/latest.json`));
	const at = (file: string): string => `${folder}/runs/${runId}/${file}`;
	const manifest = recordedManifestSchema.parse(await json(at('manifest.json')));
	const schedule = scheduleSchema.parse(await json(at('schedule.json')));
	const kickoffs = schedule.slates.flatMap((slate) => slate.games.map((game) => game.kickoff));
	const firstKickoff = kickoffs.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
	const sizes: Record<string, number> = {};
	for (const format of manifest.formats) {
		try {
			sizes[format.id] = boardSchema.parse(await json(at(`boards/${format.id}.json`))).rows.length;
		} catch {
			// A run the fixture keeps one board of: the page's value words are not held for the others.
		}
	}
	return {
		name,
		manifest,
		capture: captureOf(await json(at('designations.json'))),
		adp: adpSchema.parse(await json(at('adp.json'))),
		clubs: clubsSchema.parse(await json(at('clubs.json'))),
		firstKickoff,
		boardSizes: sizes,
		page: async (id) => playerSchema.parse(await json(at(`players/${id}.json`)))
	};
}

/** The format a page leads with: the first of the run's that ranks him (player.ts linesFor). */
function leadOf(manifest: RecordedManifest, page: Player): Format {
	const lead = manifest.formats.find((format) => page.formats[format.id] !== undefined);
	if (!lead) throw new Error(`No format of ${manifest.runId} ranks ${page.name}.`);
	return lead;
}

// MARK: the held-read cases (week-read.test.ts, status-held.test.ts)

const MOVED = 'The published projection moved since this read was written.';
const READ: WeekRead = weekReadSchema.parse({
	week: 7,
	body: 'Josh Allen gets the Jets at home, and the published projection has him at 26.4 points.',
	caption: 'Written Fri 9:00 pm Central, for week 7',
	status: null,
	call: 'start',
	writtenAt: '2026-10-17T02:00:00.000Z',
	factsAt: '2026-10-17T02:00:00.000Z',
	projection: 26.4,
	movedCaption: MOVED
});
const STATUS_CAPTION =
	'His status changed since this read was written. A new read is due by Sat 9:00 am Central.';

function ppr(points: number | null, state: ReadGameState = 'upcoming', week = 7): CardProjection {
	return { week, scoring: 'ppr', points, state };
}

interface ReadCase {
	name: string;
	read: WeekRead;
	card: CardProjection | null;
	shown: ShownRead;
}

function readCase(name: string, read: WeekRead, card: CardProjection | null): ReadCase {
	return { name, read, card, shown: shownWeekRead(read, card) };
}

function weekReadCases(): ReadCase[] {
	const withheld = { ...READ, body: null, caption: STATUS_CAPTION };
	const older = weekReadSchema.parse({
		...READ,
		projection: undefined,
		movedCaption: undefined
	});
	return [
		readCase('the read stands at the figure it quotes', READ, ppr(26.4)),
		...[26.9, 25.9, 27.0, null].map((points) =>
			readCase(`withheld before kickoff, the card at ${String(points)}`, READ, ppr(points))
		),
		...[26.8, 26.0, 26.5].map((points) =>
			readCase(`a move under 0.5 shows the read, the card at ${String(points)}`, READ, ppr(points))
		),
		readCase('a bye is judged as before kickoff', READ, ppr(20, null)),
		...(['kicked_off', 'final'] as const).flatMap((state) => [
			readCase(`${state}: the read stands whatever the card prints`, READ, ppr(4.6, state)),
			readCase(`${state}: the read stands with no figure`, READ, ppr(null, state)),
			readCase(`${state}: a withheld read says it was not written`, withheld, ppr(25.1, state)),
			readCase(`${state}: another week's game keeps the caption`, withheld, ppr(25.1, state, 8))
		]),
		readCase('as built until the card reads', READ, null),
		readCase('as built in another scoring', READ, {
			week: 7,
			scoring: 'half_ppr',
			points: 22.1,
			state: 'upcoming'
		}),
		readCase('as built for another week', READ, ppr(20, 'upcoming', 8)),
		readCase('a read from before its figure is not judged', older, ppr(20)),
		...(['upcoming', null] as const).map((state) =>
			readCase(`withheld for his status, ${String(state)}`, withheld, ppr(25.1, state))
		),
		readCase('withheld for his status, the card unread', withheld, null),
		readCase('the run already withheld it', { ...READ, body: null, caption: MOVED }, ppr(26.4))
	];
}

/** The status-held cases: the stand-in's Etienne read and capture at the build's clocks. */
async function statusHeldCases(standin: Run): Promise<unknown[]> {
	const etienne = '4239996';
	const page = await standin.page(etienne);
	const read = page.weekRead;
	const capture = standin.capture;
	if (!read || !capture) throw new Error('The stand-in holds no read or capture for Etienne.');
	const listed = capture.players[etienne];
	const ir = {
		status: 'injured_reserve',
		seasonLong: true,
		since: '2026-10-01T15:00:00.000Z'
	} as const;
	const back = {
		status: 'injured_reserve',
		seasonLong: true,
		since: '2026-10-14T01:00:00.000Z'
	} as const;
	const rest = Object.fromEntries(Object.entries(capture.players).filter(([id]) => id !== etienne));
	const cases: {
		name: string;
		read: WeekRead;
		capture: Designations | null;
		now: string;
	}[] = [
		{
			name: 'due back on a capture read after the read',
			read,
			capture,
			now: CLOCKS.week
		},
		{
			name: 'the run caption at Friday 10 pm Eastern',
			read,
			capture,
			now: '2026-10-17T02:00:00.000Z'
		},
		{
			name: 'written after the capture: it stands',
			read: {
				...read,
				writtenAt: '2026-10-14T03:00:00.000Z',
				status: 'questionable'
			},
			capture,
			now: CLOCKS.week
		},
		{
			name: 'his status unchanged: it stands',
			read,
			capture: { ...capture, players: { ...capture.players, [etienne]: ir } },
			now: CLOCKS.week
		},
		{
			name: 'back on the list in a run begun after the read',
			read,
			capture: { ...capture, players: { ...capture.players, [etienne]: back } },
			now: CLOCKS.week
		},
		{
			name: 'cleared from the list since',
			read,
			capture: { ...capture, players: rest },
			now: CLOCKS.week
		},
		{
			name: 'no capture to judge it by',
			read,
			capture: null,
			now: CLOCKS.week
		}
	];
	if (listed?.returning !== '2026-10-18')
		throw new Error('The capture no longer has Etienne due back.');
	return cases.map((c) => ({
		...c,
		id: etienne,
		built: readAtStatus(c.read, c.capture, etienne, Date.parse(c.now))
	}));
}

function nextPassCases(): { after: string; at: string }[] {
	return [
		'2026-10-17T02:00:00.000Z',
		'2026-10-17T06:30:00.000Z',
		'2026-10-17T14:00:00.000Z',
		'2026-10-18T03:30:00.000Z',
		'2026-10-18T04:30:00.000Z'
	].map((after) => ({
		after,
		at: new Date(nextHourlyPass(Date.parse(after))).toISOString()
	}));
}

// MARK: the sheets

/** The fixture API's week for him: in the league, or with none. */
async function weekOf(id: string, clock: string, league: boolean): Promise<PlayerWeek> {
	const file = league
		? `inseason/player-${LEAGUE}-${id}-${clockPart(clock)}.json`
		: `inseason/player-${id}-${clockPart(clock)}.json`;
	return ((await json(file)) as { data: PlayerWeek }).data;
}

/** The shelf over his page and his week at the clock (PlayerShelf.svelte): the card's build from his
 * page in `format`, the week's read worded over it, his Pts in place of Proj once his game has kicked
 * off by the line's own state, and the read as the shelf shows it. */
function shelfAt(
	page: Player,
	format: Format,
	season: number,
	capture: Designations | null,
	week: PlayerWeek,
	league: CardLeague | null,
	now: number
): unknown {
	const line = week.line as PlayerLine;
	const state = lineState(line, now);
	const listed = capture?.players[page.id];
	const numbers = page.formats[format.id];
	if (!numbers) throw new Error(`${page.name} has no ${format.id} figures.`);
	const card = cardBuild(page.season, page.capsule);
	const status = rowStatus(
		line.facts.designation,
		line.player.injured_reserve,
		state === 'upcoming',
		ZONE
	);
	const read = page.weekRead ? readAtStatus(page.weekRead, capture, page.id, now) : null;
	const live = liveCard({
		week,
		player: {
			id: page.id,
			name: page.name,
			team: page.team,
			position: page.position
		},
		league,
		tiles: builtTiles(
			{ card },
			{ restTile: restTile(format, numbers, page.position, season, listed) }
		),
		opponents: card.opponents,
		games: card.games,
		rest: restParts(format, numbers, page.position, listed),
		held: status?.rank ?? null,
		read,
		screenHref: () => '',
		zone: ZONE,
		now
	});
	const tiles = gameTiles(live.tiles, state, line.facts.points_this_week);
	return {
		head: live.head,
		cell: live.cell,
		tiles: tiles.map(({ key, label, value, tone }) => ({
			key,
			label,
			value,
			tone
		})),
		basis: live.basis,
		read:
			read === null
				? { written: false, words: noReadWords(state) }
				: {
						written: true,
						...shownWeekRead(read, { ...live.projection, state })
					}
	};
}

async function sheetCases(standin: Run, contract: Run): Promise<unknown[]> {
	const host = { id: LEAGUE, host: 'ffpc' } as const satisfies CardLeague;
	const restFormat = contract.manifest.formats[0];
	if (restFormat?.rosFromWeek === undefined)
		throw new Error('The contract run ranks no rest of season.');
	const cases: unknown[] = [];
	for (const id of SHEET_PLAYER_IDS) {
		const page = await standin.page(id);
		const lead = leadOf(standin.manifest, page);
		for (const name of SHEET_CLOCKS) {
			const clock = CLOCKS[name];
			const week = await weekOf(id, clock, true);
			const at = Date.parse(clock);
			cases.push({
				player: id,
				clock,
				league: true,
				format: { run: 'standin', id: lead.id },
				...(shelfAt(page, lead, standin.manifest.season, standin.capture, week, host, at) as object)
			});
		}
		// The same week on the contract run's rest-of-season format: the in-season form of Rest of season.
		const week = await weekOf(id, CLOCKS.week, true);
		cases.push({
			player: id,
			clock: CLOCKS.week,
			league: true,
			format: { run: 'contract', id: restFormat.id },
			...(shelfAt(
				{
					...page,
					formats: {
						[restFormat.id]: page.formats[lead.id]
					} as Player['formats']
				},
				restFormat,
				contract.manifest.season,
				standin.capture,
				week,
				host,
				Date.parse(CLOCKS.week)
			) as object)
		});
	}
	for (const id of PUBLIC_SHEET_PLAYER_IDS) {
		const page = await standin.page(id);
		const lead = leadOf(standin.manifest, page);
		const week = await weekOf(id, CLOCKS.week, false);
		cases.push({
			player: id,
			clock: CLOCKS.week,
			league: false,
			format: { run: 'standin', id: lead.id },
			...(shelfAt(
				page,
				lead,
				standin.manifest.season,
				standin.capture,
				week,
				null,
				Date.parse(CLOCKS.week)
			) as object)
		});
	}
	return cases;
}

// MARK: the pages

async function pageCases(run: Run, ids: readonly string[]): Promise<unknown[]> {
	const underway = Date.parse(run.manifest.runAt) >= Date.parse(run.firstKickoff);
	return Promise.all(
		ids.map(async (id) => {
			const page = await run.page(id);
			const format = leadOf(run.manifest, page);
			const numbers = page.formats[format.id];
			if (!numbers) throw new Error(`${page.name} has no ${format.id} figures.`);
			const listed = run.capture?.players[id];
			const heldOut = listed?.seasonLong === true;
			// The rest's lead line is not held here: only whether the run ranks the rest of the season.
			const rest = restFigures(
				format,
				numbers,
				{ scoring: format.label, through: '' },
				run.manifest.season
			);
			const sources = run.adp.sources
				.filter((source) => source.formats.includes(format.id))
				.map((source) => `${source.drafts}, ${windowLabel(source.window)}`);
			const size = run.boardSizes[format.id];
			const words = lineWords({ format, numbers, rest }, sources, size ?? 0, {
				year: run.manifest.season,
				underway,
				heldOut
			});
			const club = run.clubs.find((candidate) => candidate.abbr === page.team);
			return {
				run: run.name,
				player: id,
				format: format.id,
				underway,
				words: size === undefined ? { ...words, value: null } : words,
				figure: fixed(numbers.projected),
				clubName: club ? `${club.city} ${club.nickname}` : page.team,
				readStamp:
					page.capsule?.writtenAt === undefined
						? null
						: `Written ${dayLabel(page.capsule.writtenAt)}, ${CARD.writtenFrom}`,
				pulls: readFigures(page.capsule?.pulls ?? [], {
					label: format.label,
					preseason: numbers.projected,
					rest: null
				}),
				heldTier: heldOut && listed ? heldTierWords(listed.status) : null
			};
		})
	);
}

/** The contract run's pages, by its index. */
async function contractIds(): Promise<string[]> {
	const { runId } = latestPointerSchema.parse(await json('run/runs/latest.json'));
	const index = (await json(`run/runs/${runId}/index.json`)) as {
		id: string;
		orderBasis?: string;
	}[];
	// The index lists the kickers and defenses too (orderBasis market): they have no page.
	return index.filter((entry) => entry.orderBasis !== 'market').map((entry) => entry.id);
}

// MARK: the verbs

function verbCases(): unknown[] {
	const hosts = ['espn', 'sleeper', 'yahoo', 'mfl', 'ffpc'] as const;
	const player = {
		id: '4431299',
		name: 'Rome Odunze',
		team: 'CHI',
		position: 'WR'
	};
	const verbs: NonNullable<PlayerWeek['verb']>[] = [
		{ kind: 'start', holder: null, host_url: null, note: null },
		{ kind: 'lineup', holder: null, host_url: null, note: null },
		{ kind: 'trade', holder: 'Team 7', host_url: null, note: null },
		{
			kind: 'claim',
			holder: null,
			host_url: null,
			note: 'Waivers clear Wednesday.'
		},
		{ kind: 'waivers', holder: null, host_url: null, note: null },
		{
			kind: 'waivers',
			holder: null,
			host_url: 'https://fantasy.espn.com/football/players/add',
			note: null
		},
		{
			kind: 'waivers',
			holder: null,
			host_url: 'https://fantasy.espn.com/football/players/add',
			note: 'On waivers until Wednesday.'
		}
	];
	return hosts.flatMap((host) =>
		verbs.map((verb) => {
			const said = verbOf(verb, { id: LEAGUE, host }, player, () => '');
			return {
				host,
				verb,
				label: said.label,
				external: said.external,
				note: said.note
			};
		})
	);
}

/** heldVerb: Start him becomes the way to the lineup once his game has kicked off. */
async function heldVerbCases(): Promise<unknown[]> {
	const start = {
		kind: 'start',
		holder: null,
		host_url: null,
		note: null
	} as const;
	return Promise.all(
		SHEET_CLOCKS.map(async (name) => {
			const week = await weekOf(SHEET_PLAYER_IDS[0] ?? '', CLOCKS[name], true);
			return {
				player: SHEET_PLAYER_IDS[0],
				clock: CLOCKS[name],
				kind: heldVerb(start, week.line, Date.parse(CLOCKS[name])).kind
			};
		})
	);
}

export async function renderPlayerSheet(about: string): Promise<string> {
	const [standin, contract] = await Promise.all([runOf('standin'), runOf('contract')]);
	const parity = {
		about,
		zone: ZONE,
		weekRead: weekReadCases(),
		noRead: (['upcoming', null, 'kicked_off', 'final'] as const).map((state) => ({
			state,
			words: noReadWords(state)
		})),
		statusHeld: await statusHeldCases(standin),
		nextPass: nextPassCases(),
		sheets: await sheetCases(standin, contract),
		pages: [
			...(await pageCases(standin, SHEET_PLAYER_IDS)),
			...(await pageCases(contract, await contractIds()))
		],
		verbs: verbCases(),
		heldVerbs: await heldVerbCases()
	};
	return `${JSON.stringify(parity, null, '\t')}\n`;
}
