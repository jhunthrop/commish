/** A player's page: his numbers in the default format, his tier and its mates, where drafters take
 * him and from which sources, his capsule, and his numbers in every other format the run carries. */
import { tierOf } from '#lib/run/derive.ts';
import type { Capsule, Format, IndexEntry, PlayerFormat } from '#lib/run/schema.ts';
import type { Position } from '#lib/types/player.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import { adp, board, entryBySlug, index, manifest, player } from '../run.ts';

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
}

export interface PlayerPage {
	id: string;
	slug: string;
	name: string;
	position: Position;
	team: string;
	headshot: string;
	format: Format;
	numbers: PlayerFormat;
	/** Every format that ranks him, the page's own first. */
	lines: FormatLine[];
	tier: { tier: number; cliff: TierCliff | null; mates: TierMate[] };
	/** The named sources whose ADP the format's board blends. */
	adpSources: string[];
	boardSize: number;
	capsule: Capsule | null;
}

export async function playerEntries(): Promise<{ slug: string }[]> {
	return (await index()).map(({ slug }) => ({ slug }));
}

/** His formats in the manifest's order, the first one that ranks him leading. */
function linesFor(
	formats: readonly Format[],
	numbers: Readonly<Record<string, PlayerFormat>>
): FormatLine[] {
	return formats.flatMap((format) => {
		const found = numbers[format.id];
		return found ? [{ format, numbers: found }] : [];
	});
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

export async function playerPage(slug: string): Promise<PlayerPage> {
	const entry = await entryBySlug(slug);
	const [loaded, run, sources] = await Promise.all([player(entry.id), manifest(), adp()]);
	const lines = linesFor(run.formats, loaded.formats);
	const [lead] = lines;
	if (!lead) throw new Error(`${loaded.name} has a page but no format ranks him.`);
	const loadedBoard = await board(lead.format.id);
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
		adpSources: sources.sources
			.filter((source) => source.formats.includes(lead.format.id))
			.map((source) => `${source.name} ${source.drafts}`),
		boardSize: loadedBoard.rows.length,
		capsule: loaded.capsule
	};
}
