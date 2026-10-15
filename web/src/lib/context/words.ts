/** The site's context in words (founder ruling 2026-10-13: the league is the site's context): what
 * the shell's switch says. The basis line a page prints about the league is note-words.ts and the
 * marks on players are held-words.ts, so the shell's shared script carries only the switch. Pure, so
 * the switch, the pages and the tests read one spelling. */
import type { components } from '#lib/api/types.ts';
import { followedName } from '#lib/league/names.ts';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';

type Schemas = components['schemas'];
export type ContextLeague = Schemas['ContextLeague'];
export type BoardFormat = Schemas['BoardFormat'];

/** The format every page opens in when the context names none: the run's default board. */
export const DEFAULT_CONTEXT_FORMAT: BoardFormat = 'ppr';

/** A followed league's name, or its host's when its read has none yet. */
export const leagueName = followedName;

/** The switch's own words: the selected league's name, else the format pages are in. */
export function switchLabel(league: ContextLeague | null, format: BoardFormat | null): string {
	return league ? leagueName(league) : FORMAT_LABELS[format ?? DEFAULT_CONTEXT_FORMAT];
}
