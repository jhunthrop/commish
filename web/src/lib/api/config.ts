/** Where the request API lives. Production unless the build says otherwise: a local API in
 * development (http://localhost:8080), or a preview's. */
export const PRODUCTION_API_URL = 'https://api.trycommish.app';

/** How long a call waits for the API before it reads as "can't reach" (launch audit G1): Cloud Run
 * would hold a hung request for a minute. A read waits 8 s (a cold start is about 7), a state change
 * 20 s, and a call the API answers only after reading the platform live (connecting one, its league
 * list) 45 s, past the API's own 40 s budget for connecting ESPN. */
export const REQUEST_TIMEOUT_MS = { read: 8_000, write: 20_000, platform: 45_000 } as const;

export type RequestTimeout = keyof typeof REQUEST_TIMEOUT_MS;
export type RequestTimeouts = Readonly<Record<RequestTimeout, number>>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The API origin from PUBLIC_API_URL: https anywhere, http only on this machine. */
export function parseApiUrl(value: string | undefined): string {
	const raw = value?.trim() ?? '';
	if (raw === '') return PRODUCTION_API_URL;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`PUBLIC_API_URL "${raw}" is not a URL.`);
	}
	const local = LOCAL_HOSTS.has(url.hostname);
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
		throw new Error(`PUBLIC_API_URL "${raw}" must be https, or http on localhost.`);
	}
	if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		throw new Error(`PUBLIC_API_URL "${raw}" must be an origin with no path.`);
	}
	return url.origin;
}
