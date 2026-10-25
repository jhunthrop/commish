// The recorded Sleeper league's players on a run's board (build.ts since Lane 25): a Sleeper player is
// placed on the board by his name and position, a defense never. build.ts draws the member's answers
// by it, other-game-lines.ts the other game's lines (Lane 204).
import type { BoardRow } from './run-lines.ts';

/** One player of the replay's players.json. */
export interface SleeperPlayer {
	full_name?: string;
	first_name?: string;
	last_name?: string;
	position: string;
	team: string | null;
}

/** "amon-ra st brown": a name as both sources can agree on it. */
export function nameKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/[.'’]/g, '')
		.replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
		.replace(/[^a-z]+/g, ' ')
		.trim();
}

/** His name as Sleeper gives it. */
export function sleeperName(p: SleeperPlayer): string {
	return p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
}

/** The board row for a Sleeper player by his id, by name and position; null off the board. */
export function boardPlacer(
	rows: readonly BoardRow[],
	players: Readonly<Record<string, SleeperPlayer>>
): (id: string) => BoardRow | null {
	const byKey = new Map(rows.map((r) => [`${nameKey(r.name)}|${r.position}`, r] as const));
	return (id) => {
		const p = players[id];
		return p ? (byKey.get(`${nameKey(sleeperName(p))}|${p.position}`) ?? null) : null;
	};
}
