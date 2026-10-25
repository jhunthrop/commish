// The week's projection on a fixture line, read as the API reads it (api/internal/boards/
// projections.go): a player's by his board id, a defense's by his club, a kicker with no row of his own
// by his club's one kicker, the PPR column (the recorded league scores most like PPR); null without a
// row, and null for a club with no game this week (a bye), whatever the snapshot holds. project.ts
// stamps the answers with it, other-game-lines.ts the other game's lines (Lane 204).
import type { PlayerLine } from '../../src/lib/league/inseason/api.ts';

const DEFENSE = 'DEF';
const KICKER = 'K';
const PROVIDER_KICKER = 'PK';

interface ProjectionRow {
	position: string;
	team: string;
	ppr: number;
	half: number;
	standard: number;
}

/** data/projection.json: the one projection snapshot the fixture stamps with. */
export interface Projection {
	players: Record<string, ProjectionRow>;
	defenses: Record<string, number>;
}

/** The provider's club codes in the board's (boards.ProductTeam). */
const PRODUCT_TEAM: Readonly<Record<string, string>> = { WAS: 'WSH', LA: 'LAR' };
export const club = (code: string): string => PRODUCT_TEAM[code] ?? code;

/** A line's week projection by the snapshot. */
export function weekProjectionOf(projection: Projection): (line: PlayerLine) => number | null {
	const kickers = new Map<string, number | null>();
	for (const row of Object.values(projection.players)) {
		if (row.position !== PROVIDER_KICKER) continue;
		const team = club(row.team);
		kickers.set(team, kickers.has(team) ? null : row.ppr);
	}
	const defenses = new Map(Object.entries(projection.defenses).map(([c, v]) => [club(c), v]));
	return ({ player, facts }) => {
		if (facts.bye || facts.opponent === null) return null;
		if (player.position === DEFENSE) return defenses.get(club(player.team)) ?? null;
		const own = player.board_id === null ? undefined : projection.players[player.board_id];
		if (own) return own.ppr;
		return player.position === KICKER ? (kickers.get(club(player.team)) ?? null) : null;
	};
}
