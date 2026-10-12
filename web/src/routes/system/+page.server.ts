import {
	LOBBY_BUG,
	ROOM_KEYS,
	ROW_PLAYER,
	SCORING_UNIT,
	SOLO_ROOM,
	SOLO_TEAM,
	VALUE_PLAYERS,
	WR_RANGE_SCALE,
	WR_TIER
} from '../../fixtures/mock-2026-ppr.ts';
import type { PageServerLoad } from './$types';

/** Built once at deploy like every nightly page, and measured against the same budget. The fixture
 * is read here, at build, so the browser gets the derived values and never the CSV rows. */
export const prerender = true;

export const load: PageServerLoad = () => ({
	lobbyBug: LOBBY_BUG,
	roomKeys: ROOM_KEYS,
	rowPlayer: ROW_PLAYER,
	scoringUnit: SCORING_UNIT,
	soloRoom: SOLO_ROOM,
	soloTeam: SOLO_TEAM,
	valuePlayers: VALUE_PLAYERS,
	wrRangeScale: WR_RANGE_SCALE,
	wrTier: WR_TIER
});
