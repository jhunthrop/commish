/** One player's numbers as a browser fetches them from the prerendered /data/players/<id>.json:
 * the board's sheet rail and the comparison page read these. */
import type { Player } from '#lib/run/schema.ts';
import { links } from './links.ts';

/** Everything a page needs about a player except the capsule, which only his own page prints. */
export type PlayerData = Omit<Player, 'capsule'>;

export async function fetchPlayer(id: string): Promise<PlayerData> {
	const response = await fetch(links.playerData(id));
	if (!response.ok) throw new Error(`Player ${id} answered ${String(response.status)}.`);
	return response.json<PlayerData>();
}
