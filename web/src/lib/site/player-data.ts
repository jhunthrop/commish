/** One player's numbers as a browser fetches them from the prerendered /data/players/<id>.json:
 * the board's sheet rail and the comparison page read these. */
import type { Player, PlayerStatus } from '#lib/run/schema.ts';
import { links } from './links.ts';

/** Everything a page needs about a player except the reads and the season, which only his own
 * page prints, and his status on the run's injury capture when it lists him (Lane 63), the way the
 * league page's board file carries it. */
export type PlayerData = Omit<Player, 'capsule' | 'season' | 'weekRead' | 'priorSeasons'> & {
	status?: PlayerStatus;
};

export async function fetchPlayer(id: string): Promise<PlayerData> {
	const response = await fetch(links.playerData(id));
	if (!response.ok) throw new Error(`Player ${id} answered ${String(response.status)}.`);
	return response.json<PlayerData>();
}
