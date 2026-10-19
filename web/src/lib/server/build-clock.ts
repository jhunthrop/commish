/** The build's one clock (Lane 77): every prerendered page, its built status words and the site's
 * rail are drawn at the instant the build first asks, so no two pages of one build disagree on the
 * time. The loaders and the request handler read it and hand it down; nothing below them reads the
 * clock. */
let built: number | null = null;

export function buildInstant(): number {
	built ??= Date.now();
	return built;
}
