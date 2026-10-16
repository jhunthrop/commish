/** The week's games with their facts (GET /games/week, Lane 66a): read by a league's Matchup screen
 * and the player pages, anyone may read it. */
import { PUBLIC_API_URL } from '$app/env/public';
import type { GameWeek } from '#lib/format/game-facts.ts';
import { apiClient } from './client.ts';

const client = apiClient(PUBLIC_API_URL);

/** A week's games, or the next week still to be played without one. */
export function gameWeek(week?: number): Promise<GameWeek> {
	return client.call<GameWeek>(
		week === undefined ? '/games/week' : `/games/week?week=${String(week)}`
	);
}
