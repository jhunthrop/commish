/** How a run names a board and how the API names it: the API says "half_ppr", a run says
 * "half-ppr-12" (the name with hyphens and its league size). Apart from catalog.ts so the shell and
 * a player page, which only translate one into the other, carry nothing else of the catalog. */
import { DEFAULT_TEAMS } from '#lib/format/draft.ts';
import { parseFormat } from '#lib/sheet/format.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';

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
