/** The player page's "built from" lines, built with the page (Lane 142, budget trim), so the page's
 * script carries none of their words: what his written read will be built from, in each format that
 * ranks him (run/unwritten-words.ts). Its own module so a test reaches it without the run. */
import { unwrittenLines, type UnwrittenLine } from '#lib/run/unwritten-words.ts';
import type { Position } from '#lib/types/player.ts';
import type { FormatLine } from './player.ts';

/** What the page knows that decides the lines. */
export interface UnwrittenSource {
	/** Every format that ranks him, the lead first. */
	lines: readonly Pick<FormatLine, 'format' | 'numbers' | 'boardSize' | 'rest'>[];
	position: Position;
	year: number;
	/** The word his ranks show as on a season-long list ("IR", Lane 63), null otherwise. */
	held: string | null;
	/** The season is under way: the card's own words stand in for the read. */
	underway: boolean;
	/** His written read is in the run. */
	written: boolean;
}

/** Each format's lines, keyed by the format's id; none once the season is under way or the read is
 * written, the two states the page draws no list in. */
export function unwrittenByFormat(source: UnwrittenSource): Record<string, UnwrittenLine[]> {
	if (source.underway || source.written) return {};
	return Object.fromEntries(
		source.lines.map((line) => [
			line.format.id,
			unwrittenLines({
				position: source.position,
				numbers: line.numbers,
				boardSize: line.boardSize,
				label: line.format.label,
				unit: line.format.unit,
				year: source.year,
				restOfSeason: line.rest !== null,
				held: source.held
			})
		])
	);
}
