/** A player's page: his numbers in the default format, his tier and its mates, where drafters take
 * him and from which sources, his season so far, his capsule, and his numbers in every other format
 * the run carries. */
import { FREE_AGENT_CLUB, isFreeAgent } from '#lib/format/free-agent.ts';
import { windowLabel } from '#lib/format/date.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { availableTierOf } from '#lib/run/held-places.ts';
import {
	boardRestFrom,
	playerRestFrom,
	restSpanWords,
	tierBasisWords,
	tierSpanOf
} from '#lib/run/rest-from.ts';
import type {
	AdpSource,
	Capsule,
	Club,
	ReadsDue,
	WeekRead,
	Designations,
	Format,
	IndexEntry,
	Player,
	PlayerFormat,
	PlayerStatus,
	Slate
} from '#lib/run/schema.ts';
import { lastGameClubWords } from '#lib/player/club-words.ts';
import type { Position } from '#lib/types/player.ts';
import type { UnwrittenLine } from '#lib/run/unwritten-words.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import type { CaptureStamp } from '#lib/format/designation.ts';
import { playerStatusWords, type PlayerStatusWords } from '#lib/run/status-view.ts';
import { builtSaying, captureStamp } from '../statuses.ts';
import {
	heldSeasonView,
	kickoffsFrom,
	seasonView,
	specialTeamsWeek,
	type KickoffOf,
	type SeasonView
} from './player-season.ts';
import type { PlayerSeason, PriorSeason } from '#lib/run/season.ts';
import {
	basisTiles,
	cardBuild,
	gamesLeftOf,
	restParts,
	restTile,
	type CardBuild
} from './player-card.ts';
import { unwrittenByFormat } from './player-unwritten.ts';
import { playerHead } from './head.ts';
import type { HeadMarkup } from '#lib/site/head.ts';
import { lastRead, readAtStatus } from '#lib/player/status-held.ts';
import { scheduleKickoffs, standingByline } from '#lib/player/read-byline.ts';
import type { BasisTile, CardTile, RestParts } from '#lib/player/card.ts';
import {
	adp,
	board,
	clubs,
	designations,
	entryBySlug,
	index,
	manifest,
	playerRead,
	schedule,
	seasonReach,
	seasonUnderway,
	type PlayerRead
} from '../run.ts';
import {
	formatTable,
	heldTierWords,
	lineWords,
	restFigures,
	type LineWords,
	type RestFigures
} from '#lib/run/player-words.ts';

export interface TierMate {
	id: string;
	slug: string;
	name: string;
	position: Position;
	positionRank: number;
	team: string;
	headshot: string;
	projected: number;
	/** The weeks his figure counts where they are not the page's player's ("weeks 7 to 17"), null
	 * where they are the same (Lane 162, D03). */
	span: string | null;
}

export interface FormatLine {
	format: Format;
	numbers: PlayerFormat;
	/** His format's name in the every-format table: with its basis when the table mixes the two. */
	tableLabel: string;
	words: LineWords;
	/** Null on a preseason board. */
	rest: RestFigures | null;
	/** The drafts behind this format's ADP and their window: "PPR drafts, Sep 5 to Sep 9". */
	adpSources: string[];
	/** How many players this format's board ranks. */
	boardSize: number;
	/** The card's rest-of-season tile in this format, and the parts the week's read words it from. */
	restTile: CardTile;
	restParts: RestParts | null;
	/** The in-season row under the tiles in this format (Lane 100), empty preseason. */
	basisTiles: BasisTile[];
}

export interface PlayerPage {
	id: string;
	slug: string;
	name: string;
	position: Position;
	team: string;
	headshot: string;
	/** The run's default format that ranks him, his tier's, and its numbers. */
	format: Format;
	numbers: PlayerFormat;
	/** Every format that ranks him, the default first, each with its numbers and basis: the page
	 * leads with the context's when the run carries it. */
	lines: FormatLine[];
	tier: { tier: number; cliff: TierCliff | null; mates: TierMate[] };
	/** The every-format table's points heading: "Projected", or in season "Rest of season from week 7". */
	pointsHead: string;
	/** Under the every-format table in season: why its formats need not line up (Lane 139, C02). */
	formatsNote: string | null;
	/** The tier list's caption: what its points are. */
	tierBasis: string;
	/** The default format's sentences, as its line carries them. */
	words: LineWords;
	/** The default format's rest-of-season figures, as its line carries them. */
	rest: RestFigures | null;
	/** The default format's ADP drafts and board size, as its line carries them. */
	adpSources: string[];
	boardSize: number;
	capsule: Capsule | null;
	season: SeasonView;
	/** The run was written after the season's first kickoff: his season leads the draft facts. */
	underway: boolean;
	/** His designation on the run's injury capture, null when it does not list him or the run
	 * carries no capture; with when the capture was read. */
	status: { status: PlayerStatus; capture: CaptureStamp; words: PlayerStatusWords } | null;
	/** In place of his tier mates for a player on a season-long list ("On IR, not ranked"), null
	 * otherwise. */
	heldTier: string | null;
	/** His club's city and nickname, "Los Angeles Rams". */
	clubName: string;
	/** "Now with the Dolphins. His week 5 game was for the Chargers." when his newest game line was for
	 * another club (Lane 120), null otherwise. */
	clubNote: string | null;
	/** The card's tiles and words as the build knows them (Lane 66h). */
	card: CardBuild;
	/** The default format's rest-of-season tile and its parts, as its line carries them. */
	restTile: CardTile;
	restParts: RestParts | null;
	/** The default format's in-season row under the tiles, as its line carries it. */
	basisTiles: BasisTile[];
	/** The week-ahead read (Lane 72), null until the nightly writes his. */
	weekRead: WeekRead | null;
	/** The night the coming week's reads are written, while they are not (Lane 256); null otherwise. */
	weekReadsDue: ReadsDue | null;
	/** Each week's last kickoff on the run's schedule, after which its lineup can no longer be set
	 * (Lane 100, B64). */
	lastKickoffs: Record<number, string>;
	/** A page the nightly held back (Lane 136) shown from an earlier run's copy: that run, whose stamp
	 * the page carries; null for tonight's own page and for the board's figures alone. */
	copyOf: { runId: string; runAt: string } | null;
	/** What his written read will be built from, by format id, on a page before the season with no
	 * read yet; empty otherwise. Built here so the page's script carries none of its words (Lane 142,
	 * the player page's budget). */
	unwritten: Record<string, UnwrittenLine[]>;
	/** His page's head, built with it (Lane 169): his name, club, position, rank and week's game. */
	head: HeadMarkup;
}

/** What a page is built from (run.ts playerRead): his own fields and formats, and what only a page of
 * his carries, none of it for a held page with no copy. */
interface PageSource {
	id: string;
	slug: string;
	name: string;
	position: Position;
	team: string;
	headshot: string;
	formats: Record<string, PlayerFormat>;
	season: PlayerSeason | null;
	priorSeasons: PriorSeason[];
	capsule: Capsule | null;
	weekRead: WeekRead | null;
	weekReadsDue: ReadsDue | null;
	lastGameClub: Player['lastGameClub'];
	copyOf: PlayerPage['copyOf'];
}

function sourceOf(read: PlayerRead): PageSource {
	if (read.kind === 'facts') {
		const { id, slug, name, position, team, headshot } = read.entry;
		return {
			id,
			slug,
			name,
			position,
			team,
			headshot,
			formats: read.formats,
			season: null,
			priorSeasons: [],
			capsule: null,
			weekRead: null,
			weekReadsDue: null,
			lastGameClub: null,
			copyOf: null
		};
	}
	const { player } = read;
	return {
		...player,
		priorSeasons: player.priorSeasons ?? [],
		weekRead: player.weekRead ?? null,
		weekReadsDue: player.weekReadsDue ?? null,
		lastGameClub: player.lastGameClub ?? null,
		copyOf: read.kind === 'copy' ? read.from : null
	};
}

export async function playerEntries(): Promise<{ slug: string }[]> {
	return (await index()).map(({ slug }) => ({ slug }));
}

/** His formats in the manifest's order, the first one that ranks him leading, each with the drafts
 * behind its ADP and its board's size. */
async function linesFor(
	formats: readonly Format[],
	numbers: Readonly<Record<string, PlayerFormat>>,
	sources: readonly AdpSource[],
	season: { year: number; underway: boolean; heldOut: boolean },
	tileOf: (
		format: Format,
		numbers: PlayerFormat
	) => { tile: CardTile; parts: RestParts | null; basis: BasisTile[] }
): Promise<FormatLine[]> {
	const reach = await seasonReach();
	const ranked = formats.flatMap((format) => {
		const found = numbers[format.id];
		return found ? [{ format, numbers: found }] : [];
	});
	const lines = await Promise.all(
		ranked.map(async (line) => {
			const rest = restFigures(line.format, line.numbers, reach, season.year);
			const adpSources = sources
				.filter((source) => source.formats.includes(line.format.id))
				.map((source) => `${source.drafts}, ${windowLabel(source.window)}`);
			const boardSize = (await board(line.format.id)).rows.length;
			const words = lineWords({ ...line, rest }, adpSources, boardSize, season);
			const tiles = tileOf(line.format, line.numbers);
			return {
				...line,
				rest,
				words,
				adpSources,
				boardSize,
				restTile: tiles.tile,
				restParts: tiles.parts,
				basisTiles: tiles.basis
			};
		})
	);
	const { labels } = formatTable(lines);
	return lines.map((line, i) => ({ ...line, tableLabel: labels[i] ?? line.format.label }));
}

/** His tier among the available players at his position (run/held-places.ts): a player on a
 * season-long list is no one's tier mate and counts toward no cliff, and has none of his own (his page
 * says so in its place). */
async function mates(
	format: Format,
	entry: IndexEntry,
	capture: Designations | null
): Promise<PlayerPage['tier']> {
	const rows = withStatuses((await board(format.id)).rows, capture);
	const row = rows.find((candidate) => candidate.id === entry.id);
	if (!row)
		throw new Error(`${entry.name} is not on the ${format.id} board his page says he is on.`);
	const group = availableTierOf(rows, row);
	if (group === null) return { tier: row.tier, cliff: null, mates: [] };
	const his = playerRestFrom(format, row);
	return {
		tier: group.tier,
		cliff: group.cliff,
		mates: group.rows.map((mate) => ({
			id: mate.id,
			slug: mate.slug,
			name: mate.name,
			position: mate.position,
			positionRank: mate.positionRank,
			team: mate.team,
			headshot: mate.headshot,
			projected: mate.projected,
			span: tierSpanOf(playerRestFrom(format, mate), his)
		}))
	};
}

/** The tier box's basis: preseason the season's; in season the weeks his own figure counts, as his
 * rest tile says them (Lane 162, D03), each mate counting other weeks saying his in his line. */
function tierBasisOf(
	lead: { format: Format; numbers: PlayerFormat; restParts: RestParts | null },
	season: number
): string {
	if (boardRestFrom(lead.format) === null)
		return `Projected ${lead.format.label} points, ${String(season)}`;
	const span = lead.restParts?.span ?? restSpanWords(playerRestFrom(lead.format, lead.numbers));
	return tierBasisWords(lead.format.label, season, span);
}

function clubOf(list: readonly Club[], team: string): Club {
	const club = list.find((candidate) => candidate.abbr === team);
	if (!club) throw new Error(`${team} is not among the run's clubs.`);
	return club;
}

/** His club's city and nickname; a free agent's club cell, "FA" (Lane 123). */
function clubNameOf(list: readonly Club[], team: string): string {
	if (isFreeAgent(team)) return FREE_AGENT_CLUB;
	const club = clubOf(list, team);
	return `${club.city} ${club.nickname}`;
}

/** The line saying his newest game was for another club (Lane 120), null when it was his own's or the
 * run is from before the field. */
function clubNoteOf(
	list: readonly Club[],
	loaded: Pick<PageSource, 'team' | 'lastGameClub'>
): string | null {
	const last = loaded.lastGameClub;
	if (!last) return null;
	const club = isFreeAgent(loaded.team) ? null : clubOf(list, loaded.team);
	const kind = specialTeamsWeek(last) === null ? 'game' : 'specialTeams';
	return lastGameClubWords(club, last.week, clubOf(list, last.club), kind);
}

/** His read as the build serves it (Lane 222, B186): a standing read's byline names the status read
 * this build took and the next game-day read, never the night's baked into the run; a read withheld
 * keeps its own words. */
function servedRead(
	read: WeekRead,
	capture: Designations | null,
	slates: readonly Slate[],
	now: number
): WeekRead {
	if (read.body === null) return read;
	const statusRead = capture === null ? null : lastRead(capture);
	return { ...read, caption: standingByline(read, statusRead, scheduleKickoffs(slates), now) };
}

/** His read as the page builds it: under the status caption when his designation moved since it was
 * written (status-held.ts), else with the standing byline. */
function weekReadAt(
	read: WeekRead,
	capture: Designations | null,
	playerId: string,
	slates: readonly Slate[],
	now: number
): WeekRead {
	const atStatus = readAtStatus(read, capture, playerId, now);
	return atStatus === read ? servedRead(read, capture, slates, now) : atStatus;
}

/** Each week's last kickoff across the run's schedule. */
async function lastKickoffsOf(): Promise<Record<number, string>> {
	const last: Record<number, string> = {};
	for (const slate of (await schedule()).slates) {
		for (const game of slate.games) {
			const held = last[game.week];
			if (held === undefined || Date.parse(game.kickoff) > Date.parse(held))
				last[game.week] = game.kickoff;
		}
	}
	return last;
}

/** Each week's game of his, from the run's schedule: its kickoff and its state at the run; his club's,
 * or a mover's week under another club's opponent, that club's (run/row-game.ts, Lane 136). A free
 * agent (Lane 123) has no club, so no game in any week. */
async function kickoffsOf(team: string): Promise<KickoffOf> {
	if (isFreeAgent(team)) return () => null;
	return kickoffsFrom((await schedule()).slates, team);
}

/** His season block as the page shows it; a page held back with no copy (Lane 136) has none. */
async function seasonOf(
	loaded: PageSource,
	formats: readonly Format[],
	lead: Format,
	year: number
): Promise<SeasonView> {
	if (loaded.season === null) return heldSeasonView(year, loaded.position, lead);
	return seasonView(
		loaded.season,
		loaded.position,
		formats,
		await kickoffsOf(loaded.team),
		loaded.priorSeasons,
		loaded.lastGameClub
	);
}

export async function playerPage(slug: string, now: number): Promise<PlayerPage> {
	const entry = await entryBySlug(slug);
	const [read, run, sources, underway, capture, clubList, lastKickoffs, slate] = await Promise.all([
		playerRead(entry.id),
		manifest(),
		adp(),
		seasonUnderway(),
		designations(),
		clubs(),
		lastKickoffsOf(),
		schedule()
	]);
	const loaded = sourceOf(read);
	const listed = capture?.players[entry.id];
	const lines = await linesFor(
		run.formats,
		loaded.formats,
		sources.sources,
		{
			year: run.season,
			underway,
			heldOut: listed?.seasonLong === true
		},
		(format, numbers) => ({
			tile: restTile(format, numbers, loaded.position, run.season, listed),
			parts: restParts(format, numbers, loaded.position, listed),
			basis: basisTiles(
				format,
				numbers,
				loaded.season?.games ?? 0,
				gamesLeftOf(slate.slates, loaded.team)
			)
		})
	);
	const [lead] = lines;
	if (!lead) throw new Error(`${loaded.name} has a page but no format ranks him.`);
	const tier = await mates(lead.format, entry, capture);
	const status =
		capture && listed
			? {
					status: listed,
					capture: captureStamp(capture),
					words: playerStatusWords(listed, builtSaying(capture, lead.format, now))
				}
			: null;
	return {
		id: loaded.id,
		slug: loaded.slug,
		name: loaded.name,
		position: loaded.position,
		team: loaded.team,
		headshot: loaded.headshot,
		format: lead.format,
		numbers: lead.numbers,
		lines,
		tier,
		pointsHead: formatTable(lines).head,
		formatsNote: formatTable(lines).note,
		tierBasis: tierBasisOf(lead, run.season),
		words: lead.words,
		rest: lead.rest,
		adpSources: lead.adpSources,
		boardSize: lead.boardSize,
		capsule: loaded.capsule,
		season: await seasonOf(loaded, run.formats, lead.format, run.season),
		underway,
		status,
		heldTier: listed?.seasonLong === true ? heldTierWords(listed.status) : null,
		clubName: clubNameOf(clubList, loaded.team),
		clubNote: clubNoteOf(clubList, loaded),
		card: cardBuild(loaded.season, loaded.capsule),
		restTile: lead.restTile,
		restParts: lead.restParts,
		basisTiles: lead.basisTiles,
		// A read his designation moved past since it was written keeps its body under the status caption
		// on the page and the shelf alike (Lane 162, D01; Lane 274).
		weekRead:
			loaded.weekRead === null
				? null
				: weekReadAt(loaded.weekRead, capture, entry.id, slate.slates, now),
		weekReadsDue: loaded.weekReadsDue,
		lastKickoffs,
		copyOf: loaded.copyOf,
		unwritten: unwrittenByFormat({
			lines,
			position: loaded.position,
			year: run.season,
			held: status?.words.view.rank ?? null,
			underway,
			written: loaded.capsule !== null
		}),
		head: playerHead(
			{
				...loaded,
				positionRank: listed?.seasonLong === true ? null : lead.numbers.positionRank,
				lead: lead.format,
				year: run.season
			},
			clubList
		)
	};
}
