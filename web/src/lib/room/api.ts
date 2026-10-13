/** The rooms' calls to the Go API: the solo room, the lobby, saved leagues. Every answer is the envelope
 * (ok, data, error), and every type is the one generated from api/openapi.yaml. */
import { PUBLIC_API_BASE_URL } from '$app/env/public';
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type MockRoom = Schemas['MockRoom'];
export type RoomCard = Schemas['RoomCard'];
export type MockReport = Schemas['MockReport'];
export type RoomBoard = Schemas['RoomBoard'];
export type BoardPlayer = Schemas['BoardPlayer'];
export type RoomPick = Schemas['RoomPick'];
export type LeagueSettings = Schemas['LeagueSettings'];
export type League = Schemas['League'];
export type LobbyFilling = Schemas['LobbyFilling'];
export type LobbyFormat = Schemas['LobbyFormat'];
export type LobbyRoom = Schemas['LobbyRoom'];
export type LobbySeat = Schemas['LobbySeat'];
export type RoomAction = Schemas['RoomAction'];
export type Account = Schemas['Account'];

const CSRF_COOKIE = 'commish_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD']);

export function apiBase(): string {
	return PUBLIC_API_BASE_URL.replace(/\/$/, '');
}

/** An answer that was not ok, with the API's own code and words. */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fields: Record<string, string>;

	constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.fields = fields;
	}

	get signedOut(): boolean {
		return this.status === 401;
	}
}

function csrfToken(): string | undefined {
	return document.cookie
		.split('; ')
		.find((part) => part.startsWith(`${CSRF_COOKIE}=`))
		?.slice(CSRF_COOKIE.length + 1);
}

interface Envelope {
	ok: boolean;
	data: unknown;
	error: Schemas['ErrorBody'] | null;
}

/** One call: the session cookie rides along, a state change carries the CSRF token. */
export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
	const headers: Record<string, string> = {};
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	const token = csrfToken();
	if (!SAFE_METHODS.has(method) && token !== undefined) headers[CSRF_HEADER] = token;
	const response = await fetch(`${apiBase()}${path}`, {
		method,
		credentials: 'include',
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const envelope = await response.json<Envelope>();
	if (!response.ok || !envelope.ok) {
		const error = envelope.error;
		throw new ApiError(
			response.status,
			error?.code ?? 'internal',
			error?.message ?? 'Something went wrong on our side',
			error?.fields ?? {}
		);
	}
	return envelope.data as T;
}

/** Where a signed-out drafter goes to sign in, coming back to the page they were on. */
export function signInHref(returnTo: string): string {
	return `${apiBase()}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}

export const rooms = {
	createMock: (body: Schemas['MockCreate']) => call<MockRoom>('POST', '/mocks', body),
	mock: (id: string) => call<MockRoom>('GET', `/mocks/${id}`),
	pick: (id: string, playerId: string, pick: number) =>
		call<MockRoom>('POST', `/mocks/${id}/picks`, { player_id: playerId, pick }),
	undo: (id: string, pick: number) => call<MockRoom>('POST', `/mocks/${id}/undo`, { pick }),
	autopick: (id: string, toRound: number) =>
		call<MockRoom>('POST', `/mocks/${id}/autopick?to_round=${toRound}`),
	finish: (id: string) => call<MockRoom>('POST', `/mocks/${id}/finish`),
	queue: (id: string, playerIds: readonly string[]) =>
		call<MockRoom>('PUT', `/mocks/${id}/queue`, { player_ids: playerIds }),
	card: (id: string) => call<RoomCard>('GET', `/mocks/${id}/card`),
	report: (id: string) => call<MockReport>('GET', `/mocks/${id}/report`),
	shared: (code: string) => call<MockRoom>('GET', `/shared/mocks/${code}`),
	sharedReport: (code: string) => call<MockReport>('GET', `/shared/mocks/${code}/report`),
	board: (format: RoomBoard['format']) => call<RoomBoard>('GET', `/boards/${format}`),
	leagues: () => call<League[]>('GET', '/leagues'),
	saveLeague: (name: string, settings: LeagueSettings) =>
		call<League>('POST', '/leagues', { name, settings }),
	me: () => call<Account>('GET', '/me'),
	setHandle: (handle: string) => call<Account>('PATCH', '/me', { handle }),
	lobbies: () => call<LobbyFilling[]>('GET', '/lobbies'),
	join: (format: LobbyFormat) => call<LobbySeat>('POST', '/lobbies/join', { format }),
	lobby: (id: string) => call<LobbyRoom>('GET', `/lobbies/${id}`),
	leave: (id: string) => call<null>('POST', `/lobbies/${id}/leave`),
	lobbyCard: (id: string) => call<RoomCard>('GET', `/lobbies/${id}/card`),
	lobbyReport: (id: string) => call<MockReport>('GET', `/lobbies/${id}/report`)
};
