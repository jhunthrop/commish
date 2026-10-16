/** The figures set beside our read on a player's page, each saying what it is. The writer's pulls are
 * numbers the prose states; the one that is his preseason projection is named so, matched at the
 * precision the prose writes it. Once the run ranks the rest of the season, its figure, from the
 * run and not the prose, leads, and the preseason projection follows as a fact. Pure, so the tests
 * read what the page prints. */
import { fixed } from '#lib/format/number.ts';
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
	/** Once the run ranks the rest of the season: his points for it and the first week it counts. */
	rest: { points: number; fromWeek: number } | null;
}

export const PRESEASON_PROJECTION = 'Preseason projection';
export const REST_OF_SEASON = 'Rest of season';

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
	const named = pulls.map((pull) =>
		preseason !== null && writes(pull.figure, preseason)
			? { ...pull, label: PRESEASON_PROJECTION }
			: pull
	);
	if (rest === null) return named;
	const lead: ReadFigure = {
		label: REST_OF_SEASON,
		figure: fixed(rest.points),
		caption: `${basis.label} points from week ${String(rest.fromWeek)}`
	};
	return [lead, ...named];
}
