import { systemNightly } from '#lib/server/pages/system.ts';
import { stamp } from '#lib/server/run.ts';
import {
	BOARD_SIZE,
	LOBBY_BUG,
	ROOM_KEYS,
	SOLO_ROOM,
	SOLO_TEAM,
	VALUE_PLAYERS,
	WR_TIER
} from '../../fixtures/mock-2026-ppr.ts';
import type { PageServerLoad } from './$types';

/** Built once at deploy like every nightly page, and measured against the same budget. The fixture
 * is read here, at build, so the browser gets the derived values and never the CSV rows. The
 * nightly page parts come from the run the build reads, so they show a real player too. */
export const prerender = true;

export const load: PageServerLoad = async () => ({
	boardSize: BOARD_SIZE,
	lobbyBug: LOBBY_BUG,
	roomKeys: ROOM_KEYS,
	soloRoom: SOLO_ROOM,
	soloTeam: SOLO_TEAM,
	valuePlayers: VALUE_PLAYERS,
	wrTier: WR_TIER,
	run: await stamp(),
	nightly: await systemNightly()
});
