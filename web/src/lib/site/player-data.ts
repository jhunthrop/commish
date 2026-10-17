/** One player's numbers as a browser fetches them from the prerendered /data/players/<id>.json:
 * the board's sheet rail and the comparison page read these. */
import type { IndexSeason, Player, PlayerStatus } from '#lib/run/schema.ts';
import { links } from './links.ts';

/** Everything a page needs about a player except the reads and the game log, which only his own
 * page prints, his season so far and last season's line in brief, and his status on the run's injury capture when it lists him (Lane 63), the way the
 * league page's board file carries it. */
export type PlayerData = Omit<Player, 'capsule' | 'season' | 'weekRead' | 'priorSeasons'> & {
	status?: PlayerStatus;
	/** His games and points a game this season, once it is underway (Compare's 2026 rows, Lane 66n). */
	seasonSoFar?: IndexSeason;
	/** Last season's games and points a game, when he played (Compare's 2025 row). */
	lastSeason?: LastSeason;
};

/** A season before this one as Compare prints it. */
export interface LastSeason {
	season: number;
	games: number;
	pointsPerGame: number | null;
}

export async function fetchPlayer(id: string): Promise<PlayerData> {
	const response = await fetch(links.playerData(id));
	if (!response.ok) throw new Error(`Player ${id} answered ${String(response.status)}.`);
	return response.json<PlayerData>();
}
