/** A player's page: his numbers in the default format, his tier and its mates, where drafters take
 * him and from which sources, his season so far, his capsule, and his numbers in every other format
 * the run carries. */
import { windowLabel } from '#lib/format/date.ts';
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
	seasonUnderway
} from '../run.ts';
import {
	formatTable,
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
	const lines = await Promise.all(
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
	const { labels } = formatTable(lines);
	return lines.map((line, i) => ({ ...line, tableLabel: labels[i] ?? line.format.label }));
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
		pointsHead: formatTable(lines).head,
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
