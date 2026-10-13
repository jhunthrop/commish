/** The rooms' verbs that cross pages: run a mock, copy its link, name its seats. */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { type LeagueSettings, rooms } from './api.ts';

/** How long "Link copied" stays. */
export const COPIED_MS = 2000;

/** Starts a mock with these settings and goes to its room. */
export async function startMock(settings: LeagueSettings, leagueId?: string): Promise<void> {
	const room = await rooms.createMock(leagueId ? { league_id: leagueId } : { settings });
	if (!room.id) throw new Error('The new mock came back without an id.');
	await goto(resolve('/mock/[id]', { id: room.id }));
}

/** "Run it again from slot 8": the same league from the same slot, a new seed. */
export function runAgain(settings: LeagueSettings, slot: number): Promise<void> {
	return startMock({ ...settings, slot });
}

/** Copies a shared draft's link; true while "Link copied" shows. */
export async function copyShareLink(code: string): Promise<boolean> {
	await navigator.clipboard.writeText(`${location.origin}/mock/share/${code}`);
	return true;
}

/** A solo room's seats: you, and the bots numbered around you. */
export function botNames(teams: number, slot: number): string[] {
	return Array.from({ length: teams }, (_, i) =>
		i + 1 === slot ? 'You' : `Bot ${i + 1 < slot ? i + 1 : i}`
	);
}
