/** The rooms' verbs that cross pages: run a mock, copy its link, name its seats. */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { type LeagueSettings, rooms } from './api.ts';

/** How long "Link copied" stays before the verb reads as itself again. */
export const COPIED_MS = 3000;

/** Starts a mock with these settings and goes to its room. A seed replays a draft's bots: the same
 * settings and seed draft the same until a pick goes another way. */
export async function startMock(
	settings: LeagueSettings,
	leagueId?: string,
	seed?: number
): Promise<void> {
	const room = await rooms.createMock(leagueId ? { league_id: leagueId } : { settings, seed });
	if (!room.id) throw new Error('The new mock came back without an id.');
	await goto(resolve('/mock/[id]', { id: room.id }));
}

/** "Run it again from slot 8": the same league from the same slot, a new seed. */
export function runAgain(settings: LeagueSettings, slot: number): Promise<void> {
	return startMock({ ...settings, slot });
}

/** "Run this draft from slot 11": a shared draft's settings and seed as the reader's own mock. */
export function runShared(settings: LeagueSettings, slot: number, seed: number): Promise<void> {
	return startMock({ ...settings, slot }, undefined, seed);
}

/** Copies a shared draft's link. */
export async function copyShareLink(code: string): Promise<void> {
	await navigator.clipboard.writeText(`${location.origin}/mock/share/${code}`);
}
