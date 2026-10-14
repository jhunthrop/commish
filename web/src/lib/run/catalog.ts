/**
 * The scoring formats the site offers, and how a run names them. The API names a format the way a
 * sheet does ("half_ppr"); a run names a board by that name with hyphens and its league size
 * ("half-ppr-12"). The board's chooser offers CHOOSER_FORMATS whatever a run carries, so a format
 * the run lacks is a page that says so, never a missing chip or a 404.
 */
import { runFormatId } from './format-ids.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
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

/** A format's scoring and season as its basis names them: "PPR, full 2026 season". */
export function scoringBasis(format: Format): string {
	return format.basis[0] ?? format.label;
}

/** The chooser's formats as run format ids and chip words. */
export const CHOOSER: readonly CatalogFormat[] = CHOOSER_FORMATS.map((format) => ({
	id: runFormatId(format),
	label: FORMAT_LABELS[format]
}));
