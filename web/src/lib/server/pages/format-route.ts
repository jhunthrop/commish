/** A format in a URL. The canonical id carries the team count ("ppr-12"); the short slug ("ppr")
 * redirects to the default team count's board, so the obvious URL is never a dead end. */
import { error, redirect } from '@sveltejs/kit';
import { DEFAULT_TEAMS } from '#lib/format/draft.ts';
import type { Format } from '#lib/run/schema.ts';
import { manifest } from '../run.ts';

const NOT_FOUND = 404;
const PERMANENT_REDIRECT = 308;

function shortSlug(format: Format): string | null {
	const suffix = `-${String(DEFAULT_TEAMS)}`;
	return format.teams === DEFAULT_TEAMS && format.id.endsWith(suffix)
		? format.id.slice(0, -suffix.length)
		: null;
}

/** The format a route's slug names. A short slug redirects to its canonical page, built by `href`. */
export async function formatForRoute(slug: string, href: (id: string) => string): Promise<Format> {
	const { formats } = await manifest();
	const exact = formats.find((format) => format.id === slug);
	if (exact) return exact;
	const target = formats.find((format) => shortSlug(format) === slug);
	if (target) redirect(PERMANENT_REDIRECT, href(target.id));
	error(NOT_FOUND, 'No such format.');
}

/** Every slug a format route answers: each canonical id, and each short slug that redirects. */
export async function formatSlugs(): Promise<string[]> {
	const { formats } = await manifest();
	return formats.flatMap((format) => {
		const short = shortSlug(format);
		return short === null ? [format.id] : [format.id, short];
	});
}
