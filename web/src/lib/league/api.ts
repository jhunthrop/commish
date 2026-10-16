/** League sync's calls to the request API, typed from the generated contract. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type LeagueSync = Schemas['LeagueSync'];
export type LeagueTeam = Schemas['LeagueTeam'];
export type LeaguePlayer = Schemas['LeaguePlayer'];
export type LeagueMove = Schemas['LeagueMove'];
export type MatchupSide = Schemas['MatchupSide'];
export type LeagueMatchup = Schemas['LeagueMatchup'];
export type RosterSpot = Schemas['RosterSpot'];
export type AttachPreview = Schemas['AttachPreview'];
export type AttachInput = Schemas['AttachInput'];
export type AttachedLeague = Schemas['AttachedLeague'];
export type LeagueHost = Schemas['LeagueHost'];
export type LeagueStanding = Schemas['LeagueStanding'];

const client = apiClient(PUBLIC_API_URL);

export { ApiError };

const path = (id: string, tail: string): string =>
	`/leagues/attached/${encodeURIComponent(id)}/${tail}`;

export const leagueApi = {
	preview: (link: string) =>
		client.call<AttachPreview>('/leagues/attach/preview', { method: 'POST', body: { link } }),
	attach: (body: AttachInput) =>
		client.call<LeagueSync>('/leagues/attach', { method: 'POST', body }),
	attached: () => client.call<AttachedLeague[]>('/leagues/attached'),
	detach: (id: string) =>
		client.call<null>(`/leagues/attached/${encodeURIComponent(id)}`, { method: 'DELETE' }),
	restore: (id: string) =>
		client.call<null>(`/leagues/attached/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
	sync: (id: string) => client.call<LeagueSync>(path(id, 'sync')),
	refresh: (id: string) => client.call<LeagueSync>(path(id, 'refresh'), { method: 'POST' }),
	signInUrl: (returnTo: string) => client.signInUrl(returnTo)
};
