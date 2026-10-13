/**
 * The browser's one way to call the request API: the session cookie rides along, a state change
 * echoes the CSRF cookie, and every answer is read through the envelope (spec §2.2). A call
 * resolves to the payload or throws an ApiError carrying the envelope's code, so a caller branches
 * on the code and shows the API's own sentence.
 */
import type { components } from './types.ts';

type ErrorBody = components['schemas']['ErrorBody'];

const CSRF_COOKIE = 'commish_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Codes the client names itself, for an answer that never arrived or was not the envelope. */
export const CLIENT_CODES = { offline: 'offline', malformed: 'malformed' } as const;

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

function csrfToken(): string | null {
	const pair = document.cookie
		.split('; ')
		.find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
	return pair ? decodeURIComponent(pair.slice(CSRF_COOKIE.length + 1)) : null;
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
		const token = csrfToken();
		if (token) headers.set(CSRF_HEADER, token);
	}
	return headers;
}

function bodyFor(options: RequestOptions): BodyInit | undefined {
	if (options.body === undefined) return undefined;
	return typeof options.body === 'string' && options.contentType
		? options.body
		: JSON.stringify(options.body);
}

/** A client for the API at `origin`. `fetcher` is the window's fetch unless a caller passes one. */
export function apiClient(origin: string, fetcher: typeof fetch = fetch): ApiClient {
	return {
		async call<T>(path: string, options: RequestOptions = {}): Promise<T> {
			const method = options.method ?? 'GET';
			let response: Response;
			try {
				response = await fetcher(`${origin}${path}`, {
					method,
					credentials: 'include',
					headers: headersFor(method, options),
					body: bodyFor(options),
					signal: options.signal
				});
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
				throw new ApiError(0, { code: CLIENT_CODES.offline, message: 'We could not reach Commish' });
			}
			const parsed: unknown = await response.json().catch(() => null);
			if (!isEnvelope(parsed)) {
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
		},
		signInUrl(returnTo: string): string {
			return `${origin}/auth/login?${new URLSearchParams({ return_to: returnTo }).toString()}`;
		}
	};
}
