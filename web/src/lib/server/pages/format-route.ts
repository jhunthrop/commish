/** A format in a URL. The canonical id carries the team count ("ppr-12"); the short slug ("ppr")
 * redirects to the default team count's board, so the obvious URL is never a dead end. A format
 * the chooser offers and the run lacks answers too, with a page that says so. */
import { error, redirect } from '@sveltejs/kit';
import { DEFAULT_TEAMS } from '#lib/format/draft.ts';
import { CHOOSER, type CatalogFormat } from '#lib/run/catalog.ts';
import type { Format } from '#lib/run/schema.ts';
import { manifest } from '../run.ts';

const NOT_FOUND = 404;
const PERMANENT_REDIRECT = 308;

/** A chip in a format chooser: a format the run carries, or one it lacks (onRun false). */
export interface FormatChip extends CatalogFormat {
	onRun: boolean;
}

/** What a format route shows: the run's format, or the chooser's format the run lacks. */
export type FormatRoute =
	{ kind: 'run'; format: Format } | { kind: 'absent'; format: CatalogFormat };

function shortSlug(format: { id: string; teams: number }): string | null {
	const suffix = `-${String(DEFAULT_TEAMS)}`;
	return format.teams === DEFAULT_TEAMS && format.id.endsWith(suffix)
		? format.id.slice(0, -suffix.length)
		: null;
}

/** The chooser's formats the run lacks, as default-size formats. */
async function absentFormats(): Promise<CatalogFormat[]> {
	const { formats } = await manifest();
	return CHOOSER.filter((entry) => !formats.some((format) => format.id === entry.id));
}

/** Every chip a format chooser draws: the run's formats first, then the chooser's it lacks. */
export async function formatChips(): Promise<FormatChip[]> {
	const { formats } = await manifest();
	const absent = await absentFormats();
	return [
		...formats.map(({ id, label }) => ({ id, label, onRun: true })),
		...absent.map((format) => ({ ...format, onRun: false }))
	];
}

/** What a route's slug names, the run's format or one it lacks. A short slug redirects to its
 * canonical page, built by `href`. */
export async function formatRoute(
	slug: string,
	href: (id: string) => string
): Promise<FormatRoute> {
	const { formats } = await manifest();
	const exact = formats.find((format) => format.id === slug);
	if (exact) return { kind: 'run', format: exact };
	const absent = (await absentFormats()).find((format) => format.id === slug);
	if (absent) return { kind: 'absent', format: absent };
	const candidates = [...formats, ...(await absentFormats()).map(withDefaultTeams)];
	const target = candidates.find((format) => shortSlug(format) === slug);
	if (target) redirect(PERMANENT_REDIRECT, href(target.id));
	error(NOT_FOUND, 'No such format.');
}

/** The run's format a route's slug names, for a view only a carried format has (a position). */
export async function formatForRoute(slug: string, href: (id: string) => string): Promise<Format> {
	const route = await formatRoute(slug, href);
	if (route.kind === 'absent') error(NOT_FOUND, 'The run does not carry this format.');
	return route.format;
}

function withDefaultTeams(format: CatalogFormat): { id: string; teams: number } {
	return { id: format.id, teams: DEFAULT_TEAMS };
}

function slugsOf(format: { id: string; teams: number }): string[] {
	const short = shortSlug(format);
	return short === null ? [format.id] : [format.id, short];
}

/** Every slug a format's own page answers: each canonical id and short slug, the run's formats and
 * the chooser's it lacks. */
export async function formatSlugs(): Promise<string[]> {
	const { formats } = await manifest();
	const absent = (await absentFormats()).map(withDefaultTeams);
	return [...formats, ...absent].flatMap(slugsOf);
}

/** Every slug a view of a carried format answers (a position view). */
export async function runFormatSlugs(): Promise<string[]> {
	return (await manifest()).formats.flatMap(slugsOf);
}

/** A format route's page when the run lacks the format: the chooser, and the formats it does carry. */
export interface AbsentFormatPage {
	format: CatalogFormat;
	formats: FormatChip[];
}

export async function absentFormatPage(format: CatalogFormat): Promise<AbsentFormatPage> {
	return { format, formats: await formatChips() };
}
