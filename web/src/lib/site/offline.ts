/**
 * The offline shell's rules, shared by the service worker (src/service-worker/index.ts) and the offline
 * page (src/routes/offline). The worker keeps one thing: the offline page, which carries the board
 * of the run it was built from, so what it shows is the last run's board this browser saved. It
 * answers a page load that the network failed with that page, and nothing else: no API call, no
 * asset and no page a member opened is ever put in its cache, so a signed-in page never is.
 */

export const OFFLINE_PATH = '/offline';
/** One cache per deploy, named with the build's version; an earlier deploy's is dropped. */
export const SHELL_CACHE_PREFIX = 'commish-shell-';
/** How many of the board's rows the offline page carries. */
export const OFFLINE_BOARD_ROWS = 60;

/** The parts of a request the worker decides on. */
export interface RequestFacts {
	url: string;
	method: string;
	mode: string;
}

/** A page load on the site, other than the offline page itself, is answered offline. */
export function answersOffline(request: RequestFacts, origin: string): boolean {
	if (request.method !== 'GET' || request.mode !== 'navigate') return false;
	const url = new URL(request.url);
	return url.origin === origin && url.pathname !== OFFLINE_PATH;
}

/** An earlier deploy's shell cache, which activation deletes. Another cache is left alone. */
export function isStaleCache(name: string, current: string): boolean {
	return name.startsWith(SHELL_CACHE_PREFIX) && name !== current;
}
