/**
 * The scoring formats the site offers, and how a run names them. The API names a format the way a
 * sheet does ("half_ppr"); a run names a board by that name with hyphens and its league size
 * ("half-ppr-12"). The board's chooser offers CHOOSER_FORMATS whatever a run carries, so a format
 * the run lacks is a page that says so, never a missing chip or a 404.
 */
import { DEFAULT_TEAMS } from '#lib/format/draft.ts';
import { FORMAT_LABELS, parseFormat } from '#lib/sheet/format.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { Format } from './schema.ts';

/** The chooser's formats, in the order the chips draw. */
export const CHOOSER_FORMATS = [
	'ppr',
	'half_ppr',
	'standard',
	'superflex'
] as const satisfies readonly BoardFormat[];

export interface CatalogFormat {
	/** The run's format id: "half-ppr-12". */
	id: string;
	label: string;
}

/** "half_ppr" at 12 teams is the run's "half-ppr-12". */
export function runFormatId(format: BoardFormat, teams: number = DEFAULT_TEAMS): string {
	return `${format.replaceAll('_', '-')}-${String(teams)}`;
}

/** The API's name for a run format at the default league size, or null for any other. */
export function apiFormatOf(format: { id: string; teams: number }): BoardFormat | null {
	const suffix = `-${String(DEFAULT_TEAMS)}`;
	if (format.teams !== DEFAULT_TEAMS || !format.id.endsWith(suffix)) return null;
	return parseFormat(format.id.slice(0, -suffix.length).replaceAll('-', '_'));
}

/** A format's scoring and season as its basis names them: "PPR, full 2026 season". */
export function scoringBasis(format: Format): string {
	return format.basis[0] ?? format.label;
}

/** The chooser's formats as run format ids and chip words. */
export const CHOOSER: readonly CatalogFormat[] = CHOOSER_FORMATS.map((format) => ({
	id: runFormatId(format),
	label: FORMAT_LABELS[format]
}));
