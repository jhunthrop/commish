/** The rooms' calls to the Go API: the solo room, the lobby, saved leagues. Every answer is the envelope
 * (ok, data, error), and every type is the one generated from api/openapi.yaml. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient, type RequestOptions } from '#lib/api/client.ts';
import { HTTP_STATUS, hasStatus, isFinalRefusal, isSignedOut } from '#lib/api/status.ts';
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

/** The site's one API client (Lane 7's), at the origin the build names. */
const client = apiClient(PUBLIC_API_URL);

export { ApiError };

type Method = NonNullable<RequestOptions['method']>;

function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
	return client.call<T>(path, { method, body });
}

export { isSignedOut };

export { isFinalRefusal };

/** Whether an error is the API saying the thing is not there for this drafter at all: no seat in it
 * (403) or no such room (404). Unlike a dropped connection, waiting never brings it back. */
export function isGone(error: unknown): boolean {
	return hasStatus(error, HTTP_STATUS.forbidden, HTTP_STATUS.notFound);
}

/** Where a signed-out drafter goes to sign in, coming back to the page they were on. */
export function signInHref(returnTo: string): string {
	return client.signInUrl(returnTo);
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
	importScoring: (host: Schemas['ScoringImportInput']['host'], link: string) =>
		call<Schemas['ScoringImport']>('POST', '/leagues/import-scoring', { host, link }),
	saveLeague: (name: string, settings: LeagueSettings) =>
		call<League>('POST', '/leagues', { name, settings }),
	setHandle: (handle: string) => call<Account>('PATCH', '/me', { handle }),
	lobbies: () => call<LobbyFilling[]>('GET', '/lobbies'),
	join: (format: LobbyFormat) => call<LobbySeat>('POST', '/lobbies/join', { format }),
	lobby: (id: string) => call<LobbyRoom>('GET', `/lobbies/${id}`),
	leave: (id: string) => call<null>('POST', `/lobbies/${id}/leave`),
	lobbyCard: (id: string) => call<RoomCard>('GET', `/lobbies/${id}/card`),
	lobbyReport: (id: string) => call<MockReport>('GET', `/lobbies/${id}/report`)
};
