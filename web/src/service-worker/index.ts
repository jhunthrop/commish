/**
 * The offline shell (src/lib/site/offline.ts). Install keeps the offline page, which carries the
 * board of the run this deploy was built from; a page load the network fails is answered with it.
 * Nothing else is cached or answered: the API, the assets and every page a member opens go to the
 * network as if there were no worker, so no signed-in page is ever stored. SvelteKit registers this
 * with a few lines in each page's HTML, so no page's script carries it. Navigation preload is on,
 * so a page load's request leaves while the worker starts rather than after: a returning visitor's
 * page is never slower for the worker standing in front of it.
 */
import { version } from '$app/env';
import { self as worker } from '$app/service-worker';
import {
	OFFLINE_PATH,
	SHELL_CACHE_PREFIX,
	answersOffline,
	isStaleCache
} from '#lib/site/offline.ts';

const CACHE = `${SHELL_CACHE_PREFIX}${version}`;

async function keepShell(): Promise<void> {
	const cache = await caches.open(CACHE);
	await cache.add(new Request(OFFLINE_PATH, { cache: 'reload' }));
	await worker.skipWaiting();
}

async function activate(): Promise<void> {
	// The type says every browser has it; Safari before 15.4 does not, and a throw here would skip the
	// cleanup and the claim below.
	const preload = (worker.registration as { navigationPreload?: NavigationPreloadManager })
		.navigationPreload;
	await preload?.enable();
	for (const name of await caches.keys()) {
		if (isStaleCache(name, CACHE)) await caches.delete(name);
	}
	await worker.clients.claim();
}

/** The preloaded page, or the network's when there was no preload, or the offline shell when the
 * network failed either way. */
async function pageOrShell(request: Request, preload: Promise<unknown>): Promise<Response> {
	try {
		const preloaded = (await preload) as Response | undefined;
		return preloaded ?? (await fetch(request));
	} catch (error) {
		const shell = await caches.match(OFFLINE_PATH, { cacheName: CACHE });
		if (shell) return shell;
		throw error;
	}
}

worker.addEventListener('install', (event) => {
	event.waitUntil(keepShell());
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(activate());
});

worker.addEventListener('fetch', (event) => {
	if (answersOffline(event.request, worker.location.origin)) {
		event.respondWith(pageOrShell(event.request, event.preloadResponse));
	}
});
