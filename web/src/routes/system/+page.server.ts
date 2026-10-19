import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import { systemNightly } from '#lib/server/pages/system.ts';
import { stamp } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

const NOT_FOUND = 404;

/** The design page is dev-only (ruling R4): `npm run dev` draws it, and a build neither prerenders
 * it nor serves it, so production answers 404 and its stand-in board is never read in public. The
 * fixture is read here, on the dev server, so the browser gets the derived values and never the CSV
 * rows. The nightly page parts come from the run the build reads, so they show a real player too. */
export const prerender = dev;

export const load: PageServerLoad = async () => {
	if (!dev) error(NOT_FOUND, 'Not found');
	const { BOARD_SIZE, LOBBY_BUG, SOLO_ROOM, SOLO_TEAM, VALUE_PLAYERS, WR_TIER } =
		await import('../../fixtures/mock-2026-ppr.ts');
	return {
		boardSize: BOARD_SIZE,
		lobbyBug: LOBBY_BUG,
		soloRoom: SOLO_ROOM,
		soloTeam: SOLO_TEAM,
		valuePlayers: VALUE_PLAYERS,
		wrTier: WR_TIER,
		run: await stamp(),
		nightly: await systemNightly()
	};
};
