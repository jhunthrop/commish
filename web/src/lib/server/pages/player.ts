/** A player's page: his numbers in the default format, his tier and its mates, where drafters take
 * him and from which sources, his season so far, his capsule, and his numbers in every other format
 * the run carries. */
import { windowLabel } from '#lib/format/date.ts';
import { draftersGap } from '#lib/format/draft.ts';
import { fixed, plural } from '#lib/format/number.ts';
import { tierOf } from '#lib/run/derive.ts';
import type { AdpSource, Capsule, Format, IndexEntry, PlayerFormat } from '#lib/run/schema.ts';
import type { Position } from '#lib/types/player.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import { seasonView, type KickoffOf, type SeasonView } from './player-season.ts';
import {
	adp,
	board,
	entryBySlug,
	index,
	manifest,
	player,
	schedule,
	seasonReach,
	seasonUnderway,
	type SeasonReach
} from '../run.ts';
import { restLead } from '#lib/run/rest-words.ts';

export interface TierMate {
	id: string;
	slug: string;
	name: string;
	position: Position;
	positionRank: number;
	team: string;
	headshot: string;
	projected: number;
}

/** In season, his rest-of-season figures beside the preseason board's, and the basis line the board
 * prints. */
export interface RestFigures {
	lead: string;
	/** Null for a player the preseason board did not rank: the page shows no preseason figure. */
	preseason: { rank: number; points: number } | null;
}

/** A format line's sentences, as the page prints them for it. */
export interface LineWords {
	/** The big figure's caption. */
	caption: string;
	/** Where drafters take him against our rank. */
	drafters: string;
	/** His value's round, or below replacement, among the board. */
	value: string;
}

export interface FormatLine {
	format: Format;
	numbers: PlayerFormat;
	words: LineWords;
	/** Null on a preseason board. */
	rest: RestFigures | null;
	/** The drafts behind this format's ADP and their window: "PPR drafts, Sep 5 to Sep 9". */
	adpSources: string[];
	/** How many players this format's board ranks. */
	boardSize: number;
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
}

export async function playerEntries(): Promise<{ slug: string }[]> {
	return (await index()).map(({ slug }) => ({ slug }));
}

/** His formats in the manifest's order, the first one that ranks him leading, each with the drafts
 * behind its ADP and its board's size. */
/** "We have him at pick 12, so drafters take him 3 picks later. ADP 15.0 from PPR drafts, Sep 5 to
 * Sep 9." */
function draftersWords(
	numbers: PlayerFormat,
	sources: readonly string[],
	inSeason: boolean
): string {
	// In season the ADP is the drafts' preseason order and our rank the rest of the season's, so
	// the two are not compared: the page gives the ADP alone.
	if (inSeason) {
		return numbers.adp === null
			? 'None of our ADP sources has him.'
			: `ADP ${fixed(numbers.adp)} from ${sources.join(' and ')}.`;
	}
	const gap = draftersGap(numbers.adp, numbers.ourRank);
	if (numbers.adp === null || gap === null) {
		return `None of our ADP sources has him yet. We have him at pick ${String(numbers.ourRank)}.`;
	}
	const where =
		gap === 0
			? 'drafters take him right where we would'
			: `drafters take him ${plural(Math.abs(gap), 'pick')} ${gap > 0 ? 'later' : 'earlier'}`;
	return `We have him at pick ${String(numbers.ourRank)}, so ${where}. ADP ${fixed(numbers.adp)} from ${sources.join(' and ')}.`;
}

function lineWords(
	line: { format: Format; numbers: PlayerFormat; rest: RestFigures | null },
	sources: readonly string[],
	boardSize: number,
	season: { year: number; underway: boolean }
): LineWords {
	const { numbers, format, rest } = line;
	const year = String(season.year);
	const games = fixed(numbers.expectedGames);
	const caption =
		rest !== null
			? `${format.label} points for the rest of ${year}, our rank ${String(numbers.ourRank)}`
			: season.underway
				? `${format.label} points in ${year}, projected preseason over ${games} games`
				: `projected ${format.label} points in ${year}, over ${games} expected games`;
	const value =
		numbers.vor < 0
			? `Below replacement, among the ${String(boardSize)} on our board`
			: `Round ${String(numbers.vorRound)} value among the ${String(boardSize)} on our board`;
	return { caption, drafters: draftersWords(numbers, sources, rest !== null), value };
}

async function linesFor(
	formats: readonly Format[],
	numbers: Readonly<Record<string, PlayerFormat>>,
	sources: readonly AdpSource[],
	season: { year: number; underway: boolean }
): Promise<FormatLine[]> {
	const reach = await seasonReach();
	const ranked = formats.flatMap((format) => {
		const found = numbers[format.id];
		return found ? [{ format, numbers: found }] : [];
	});
	return Promise.all(
		ranked.map(async (line) => {
			const rest = restFigures(line.format, line.numbers, reach, season.year);
			const adpSources = sources
				.filter((source) => source.formats.includes(line.format.id))
				.map((source) => `${source.drafts}, ${windowLabel(source.window)}`);
			const boardSize = (await board(line.format.id)).rows.length;
			const words = lineWords({ ...line, rest }, adpSources, boardSize, season);
			return { ...line, rest, words, adpSources, boardSize };
		})
	);
}

function restFigures(
	format: Format,
	numbers: PlayerFormat,
	reach: SeasonReach,
	season: number
): RestFigures | null {
	const lead = restLead(format, reach, season);
	const { preseasonRank, preseasonPoints } = numbers;
	if (lead === null) return null;
	if (preseasonRank === undefined || preseasonPoints === undefined) {
		throw new Error(
			`The ${format.id} board ranks the rest of the season without his preseason figures.`
		);
	}
	const preseason =
		preseasonRank === null || preseasonPoints === null
			? null
			: { rank: preseasonRank, points: preseasonPoints };
	return { lead, preseason };
}

async function mates(format: Format, entry: IndexEntry): Promise<PlayerPage['tier']> {
	const rows = (await board(format.id)).rows;
	const row = rows.find((candidate) => candidate.id === entry.id);
	if (!row)
		throw new Error(`${entry.name} is not on the ${format.id} board his page says he is on.`);
	const group = tierOf(rows, row);
	return {
		tier: group.tier,
		cliff: group.cliff,
		mates: group.rows.map(
			({ id, slug, name, position, positionRank, team, headshot, projected }) => ({
				id,
				slug,
				name,
				position,
				positionRank,
				team,
				headshot,
				projected
			})
		)
	};
}

/** His club's kickoff in each week, from the run's schedule. */
async function kickoffsOf(team: string): Promise<KickoffOf> {
	const slate = (await schedule()).slates.find((candidate) => candidate.abbr === team);
	if (!slate) throw new Error(`${team} has no slate on the run's schedule.`);
	return (week) => slate.games.find((game) => game.week === week)?.kickoff ?? null;
}

export async function playerPage(slug: string): Promise<PlayerPage> {
	const entry = await entryBySlug(slug);
	const [loaded, run, sources, kickoffOf, underway] = await Promise.all([
		player(entry.id),
		manifest(),
		adp(),
		kickoffsOf(entry.team),
		seasonUnderway()
	]);
	const lines = await linesFor(run.formats, loaded.formats, sources.sources, {
		year: run.season,
		underway
	});
	const [lead] = lines;
	if (!lead) throw new Error(`${loaded.name} has a page but no format ranks him.`);
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
		tier: await mates(lead.format, entry),
		tierBasis:
			lead.format.rosFromWeek === undefined
				? `Projected ${lead.format.label} points, ${String(run.season)}`
				: `Projected ${lead.format.label} points for the rest of ${String(run.season)} from week ${String(lead.format.rosFromWeek)}`,
		words: lead.words,
		rest: lead.rest,
		adpSources: lead.adpSources,
		boardSize: lead.boardSize,
		capsule: loaded.capsule,
		season: seasonView(loaded.season, loaded.position, run.formats, kickoffOf),
		underway
	};
}
