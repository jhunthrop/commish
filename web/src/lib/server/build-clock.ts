/** The build's one clock (Lane 77): every prerendered page, its built status words and the site's
 * rail are drawn at the instant the build first asks, so no two pages of one build disagree on the
 * time. The loaders and the request handler read it and hand it down; nothing below them reads the
 * clock. Outside a build (the dev server, a page drawn at request time) there is no build to agree
 * with, so each request is drawn at its own instant, as it always was (review 77 finding 6). */
import { building } from '$app/env';

let built: number | null = null;

export function buildInstant(): number {
	const asked = Date.now();
	if (!building) return asked;
	built ??= asked;
	return built;
}
