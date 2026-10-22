/**
 * The browser's one way to call the request API: the session cookie rides along, a state change
 * echoes the CSRF cookie, and every answer is read through the envelope (spec §2.2). A call
 * resolves to the payload or throws an ApiError carrying the envelope's code, so a caller branches
 * on the code and shows the API's own sentence.
 */
import { REQUEST_TIMEOUT_MS, type RequestTimeout, type RequestTimeouts } from './config.ts';
import { SESSION_CSRF_COOKIE } from './session.ts';
import type { components } from './types.ts';

export { hasSessionCookie } from './session.ts';

type ErrorBody = components['schemas']['ErrorBody'];

/** Each CSRF cookie and the header that echoes it: the session's, and a signed-out browser's (a
 * solo mock drafted before sign-in). The API reads the one that matches who is calling. */
const CSRF_PAIRS = [
	[SESSION_CSRF_COOKIE, 'X-CSRF-Token'],
	['commish_anon_csrf', 'X-Anon-CSRF-Token']
] as const;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Codes the client names itself, for an answer that never arrived or was not the envelope. */
export const CLIENT_CODES = { offline: 'offline', malformed: 'malformed' } as const;

/** Google's front end answering for a service that is down, cold or past its timeout: its own HTML
 * page and no envelope, so the API never answered (launch audit G2). */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fields: Readonly<Record<string, string>>;

	constructor(status: number, body: ErrorBody) {
		super(body.message);
		this.name = 'ApiError';
		this.status = status;
		this.code = body.code;
		this.fields = body.fields ?? {};
	}
}

function cookie(name: string): string | null {
	const pair = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
	return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

interface Envelope {
	ok: boolean;
	data: unknown;
	error: ErrorBody | null;
}

function isEnvelope(value: unknown): value is Envelope {
	return typeof value === 'object' && value !== null && 'ok' in value && 'data' in value;
}

export interface RequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	/** A JSON body, or a string sent as is with `contentType`. */
	body?: unknown;
	contentType?: string;
	signal?: AbortSignal;
	/** How long to wait: a read's or a write's by the method, unless the call reads a platform live. */
	timeout?: RequestTimeout;
}

export interface ApiClient {
	/** The payload of a call, typed by the caller from the generated contract. */
	call<T>(path: string, options?: RequestOptions): Promise<T>;
	/** Where the browser goes to sign in and come back to `returnTo`, a path on this site. */
	signInUrl(returnTo: string): string;
}

function headersFor(method: string, options: RequestOptions): Headers {
	const headers = new Headers({ Accept: 'application/json' });
	if (options.body !== undefined) {
		headers.set('Content-Type', options.contentType ?? 'application/json');
	}
	if (!SAFE_METHODS.has(method)) {
		for (const [cookieName, header] of CSRF_PAIRS) {
			const token = cookie(cookieName);
			if (token) headers.set(header, token);
		}
	}
	return headers;
}

function bodyFor(options: RequestOptions): BodyInit | undefined {
	if (options.body === undefined) return undefined;
	return typeof options.body === 'string' && options.contentType
		? options.body
		: JSON.stringify(options.body);
}

/** The answer that never arrived: no network, a hung API past its wait, or Google's front end
 * answering for it. Status 0, so a caller reads it as "can't reach" and a write as maybe sent. */
function unreachable(): ApiError {
	return new ApiError(0, { code: CLIENT_CODES.offline, message: 'We could not reach Commish' });
}

/** A signal that aborts when the caller's does or when `ms` pass, and the clearing of its timer.
 * Built by hand: AbortSignal.any is missing before Safari 17.4. */
function deadline(caller: AbortSignal | undefined, ms: number): [AbortSignal, () => void] {
	const controller = new AbortController();
	const stop = (): void => {
		controller.abort(caller?.reason);
	};
	caller?.addEventListener('abort', stop);
	if (caller?.aborted) stop();
	const timer = setTimeout(stop, ms);
	return [controller.signal, () => clearTimeout(timer)];
}

/** The payload of an answer, read through the envelope. An answer that is not one is "can't reach"
 * when the wait ran out reading it or Google's front end sent it, and malformed otherwise. */
async function payload<T>(response: Response, wait: AbortSignal, caller?: AbortSignal): Promise<T> {
	const parsed: unknown = await response.json().catch(() => null);
	if (!isEnvelope(parsed)) {
		if (caller?.aborted) throw caller.reason;
		if (wait.aborted || GATEWAY_STATUSES.has(response.status)) throw unreachable();
		throw new ApiError(response.status, {
			code: CLIENT_CODES.malformed,
			message: 'Commish answered in a way we did not expect'
		});
	}
	if (!parsed.ok || parsed.error) {
		throw new ApiError(
			response.status,
			parsed.error ?? { code: CLIENT_CODES.malformed, message: 'Something went wrong' }
		);
	}
	return parsed.data as T;
}

/** A client for the API at `origin`. `fetcher` is the window's fetch and `timeouts` the site's
 * waits unless a caller (a test) passes its own. */
export function apiClient(
	origin: string,
	fetcher: typeof fetch = fetch,
	timeouts: RequestTimeouts = REQUEST_TIMEOUT_MS
): ApiClient {
	return {
		async call<T>(path: string, options: RequestOptions = {}): Promise<T> {
			const method = options.method ?? 'GET';
			const kind = options.timeout ?? (SAFE_METHODS.has(method) ? 'read' : 'write');
			const [wait, clear] = deadline(options.signal, timeouts[kind]);
			try {
				let response: Response;
				try {
					response = await fetcher(`${origin}${path}`, {
						method,
						credentials: 'include',
						headers: headersFor(method, options),
						body: bodyFor(options),
						signal: wait
					});
				} catch (cause) {
					if (options.signal?.aborted) throw cause;
					throw unreachable();
				}
				return await payload<T>(response, wait, options.signal);
			} finally {
				clear();
			}
		},
		signInUrl(returnTo: string): string {
			return `${origin}/auth/login?${new URLSearchParams({ return_to: returnTo }).toString()}`;
		}
	};
}
