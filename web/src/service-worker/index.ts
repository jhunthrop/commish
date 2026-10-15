/**
 * The offline shell (src/lib/site/offline.ts). Install keeps the offline page, which carries the
 * board of the run this deploy was built from; a page load the network fails is answered with it.
 * Nothing else is cached or answered: the API, the assets and every page a member opens go to the
 * network as if there were no worker, so no signed-in page is ever stored. SvelteKit registers this
 * with a few lines in each page's HTML, so no page's script carries it.
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

async function dropStale(): Promise<void> {
	for (const name of await caches.keys()) {
		if (isStaleCache(name, CACHE)) await caches.delete(name);
	}
	await worker.clients.claim();
}

async function pageOrShell(request: Request): Promise<Response> {
	try {
		return await fetch(request);
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
	event.waitUntil(dropStale());
});

worker.addEventListener('fetch', (event) => {
	if (answersOffline(event.request, worker.location.origin)) {
		event.respondWith(pageOrShell(event.request));
	}
});
