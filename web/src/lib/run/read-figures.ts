/** The figures set beside our read on a player's page, each saying what it is. The writer's pulls are
 * numbers the prose states, written from the preseason projection: the one that is his projection
 * (matched at the precision the prose writes it) and a tier gap (a pull whose caption names a tier)
 * are named preseason. Once the run ranks the rest of the season, its figure, from the run and not
 * the prose, leads, the preseason projection follows as the labelled last, and the preseason tier
 * gap leaves (the tier panel carries the rest of the season's). Never more than three figures, the
 * read's one row. Pure, so the tests read what the page prints. */
import { fixed } from '#lib/format/number.ts';
import { playerRestWords } from './rest-from.ts';
import type { PullFigure } from './schema.ts';

/** A figure beside the read, with the word or two that names its basis where it has one. */
export interface ReadFigure extends PullFigure {
	label?: string;
}

export interface ReadBasis {
	/** The format's name: "PPR". */
	label: string;
	/** His preseason projection for the full season, null for a player the preseason board did not rank. */
	preseason: number | null;
	/** Once the run ranks the rest of the season: his points for it and the first week it counts (his
	 * club's first game still to play, null with none left). */
	rest: { points: number; fromWeek: number | null } | null;
}

export const PRESEASON_PROJECTION = 'Preseason projection';
export const PRESEASON_TIERS = 'Preseason tiers';
export const REST_OF_SEASON = 'Rest of season';
/** The read's figures fill one row of three. */
export const MAX_READ_FIGURES = 3;
/** A pull about a tier: the gap to the next one, from the preseason tiers. */
const TIER = /\btiers?\b/i;

/** A number as prose writes it, thousands commas allowed: its decimals captured. */
const NUMBER = /^[+-]?\d[\d,]*(?:\.(\d+))?$/;

/** Whether a figure as the prose writes it is this value at the figure's own precision. */
function writes(figure: string, value: number): boolean {
	const match = NUMBER.exec(figure);
	if (!match) return false;
	const decimals = (match[1] ?? '').length;
	return Number(figure.replaceAll(',', '')) === Number(value.toFixed(decimals));
}

export function readFigures(pulls: readonly PullFigure[], basis: ReadBasis): ReadFigure[] {
	if (pulls.length === 0) return [];
	const { preseason, rest } = basis;
	const isProjection = (pull: PullFigure): boolean =>
		preseason !== null && writes(pull.figure, preseason);
	const isTierGap = (pull: PullFigure): boolean => !isProjection(pull) && TIER.test(pull.caption);
	if (rest === null) {
		return pulls.map((pull) => {
			if (isProjection(pull)) return { ...pull, label: PRESEASON_PROJECTION };
			return isTierGap(pull) ? { ...pull, label: PRESEASON_TIERS } : pull;
		});
	}
	const lead: ReadFigure = {
		label: REST_OF_SEASON,
		figure: fixed(rest.points),
		caption: `${basis.label} points ${playerRestWords(rest.fromWeek)}`
	};
	const projection = pulls.find(isProjection);
	const last: ReadFigure[] = projection ? [{ ...projection, label: PRESEASON_PROJECTION }] : [];
	const room = MAX_READ_FIGURES - 1 - last.length;
	const others = pulls.filter((pull) => !isProjection(pull) && !isTierGap(pull)).slice(0, room);
	return [lead, ...others, ...last];
}
