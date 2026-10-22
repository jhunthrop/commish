/** A page that does not exist is answered with the prerendered not-found page (routes/404, Lane 148)
 * and a 404: the build named its week and rail, so nothing on it changes after it loads. The
 * Worker's own error page (routes/+error.svelte) answers only where no build is behind the Worker
 * (the dev server) and every failure that is not a missing page. */

/** Where the build writes the not-found page among the static assets. */
export const NOT_FOUND_PATH = '/404';
const NOT_FOUND = 404;

/** The static assets as the Worker reads them (its ASSETS binding). */
export interface Assets {
	fetch(request: Request): Promise<Response>;
}

/** A reader's page request: a GET or HEAD that asks for HTML. A missing script or image is not
 * answered with a page. */
export function asksForPage(request: Request): boolean {
	const method = request.method === 'GET' || request.method === 'HEAD';
	return method && (request.headers.get('accept') ?? '').includes('text/html');
}

/** The prerendered not-found page with a 404, or null when the assets hold none (no build behind
 * the Worker), so the caller falls back to the Worker's error page. */
export async function notFoundPage(
	assets: Assets | undefined,
	request: Request
): Promise<Response | null> {
	if (assets === undefined) return null;
	// Only what the page is asked as: a reader's conditional headers (If-None-Match and the like)
	// would get a 304 with no body for the asset, never the not-found page (fix round 1).
	const page = await assets.fetch(
		new Request(new URL(NOT_FOUND_PATH, request.url), {
			method: request.method,
			headers: { accept: request.headers.get('accept') ?? 'text/html' }
		})
	);
	if (!page.ok) return null;
	return new Response(page.body, { status: NOT_FOUND, headers: page.headers });
}
