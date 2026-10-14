/** The selected league's rosters, as the pages mark who holds a player: from the league page's own
 * read when it made one, else one read of the league a session (kept in sessionStorage), never a
 * read per page. Loaded by the store only once a signed-in page with a league selected asks, so a
 * page read signed out carries none of it. */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import { siteContext } from './context.svelte.ts';
import type { Held } from './words.ts';

type LeagueSync = components['schemas']['LeagueSync'];

/** The session's copy of the rosters. */
const HELD_KEY = 'commish-held';
/** A league's rosters are read again after this long in one session. */
const HELD_FRESH_MS = 10 * 60_000;

interface KeptHeld {
	id: string;
	at: number;
	held: Held;
}

const client = apiClient(PUBLIC_API_URL);

/** The rosters a league read holds, as the pages mark them. */
export function heldOf(sync: Pick<LeagueSync, 'me' | 'teams' | 'held_by'>): Held {
	return {
		me: sync.me,
		teams: Object.fromEntries(sync.teams.map((team) => [team.roster_id, team.name])),
		// Copied, so an API from before held_by, which omits it, reads as no marks.
		by: { ...sync.held_by }
	};
}

/** A read of the league a page already made (the league page): the rosters come from it. */
export function takeHeld(id: string, sync: Pick<LeagueSync, 'me' | 'teams' | 'held_by'>): void {
	if (siteContext.league?.id !== id) return;
	const kept: KeptHeld = { id, at: Date.now(), held: heldOf(sync) };
	siteContext.heldFor = id;
	siteContext.held = kept.held;
	try {
		sessionStorage.setItem(HELD_KEY, JSON.stringify(kept));
	} catch {
		// Storage can be off or full: the rosters still hold for this page.
	}
}

function keptFor(id: string): KeptHeld | null {
	try {
		const kept = JSON.parse(sessionStorage.getItem(HELD_KEY) ?? 'null') as KeptHeld | null;
		return kept?.id === id && Date.now() - kept.at < HELD_FRESH_MS ? kept : null;
	} catch {
		return null;
	}
}

/** Reads the league's rosters once: the session's copy while fresh, else the league's sync. */
export async function readHeld(id: string): Promise<void> {
	if (siteContext.heldFor === id) return;
	siteContext.heldFor = id;
	const kept = keptFor(id);
	if (kept) {
		siteContext.held = kept.held;
		return;
	}
	try {
		takeHeld(id, await client.call<LeagueSync>(`/leagues/attached/${encodeURIComponent(id)}/sync`));
	} catch {
		// No marks is the floor: the page reads the same without them, and the next page tries again.
		if (siteContext.heldFor === id) siteContext.heldFor = null;
	}
}
