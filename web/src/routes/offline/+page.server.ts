import { OFFLINE_BOARD_ROWS } from '#lib/site/offline.ts';
import { boardSeason } from '#lib/server/board-season.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { positionRankShown, rankShown } from '#lib/run/held-places.ts';
import { board, defaultFormat, designations, stamp } from '#lib/server/run.ts';
import { STATIC_HEADS } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

/** The offline shell: the default board's top rows from the run this deploy was built from, under
 * the board's own basis line, so its points name what they are. The service worker keeps this one
 * page and shows it when the network is gone. */
export const prerender = true;

export const load: PageServerLoad = async () => {
	const [run, format, capture] = await Promise.all([stamp(), defaultFormat(), designations()]);
	// The board's order beside the capture: a player on a season-long list is never in the top as if
	// he plays (Lane 63).
	const rows = withStatuses((await board(format.id)).rows, capture);
	const { lead } = await boardSeason(format, rows.slice(0, OFFLINE_BOARD_ROWS));
	return {
		head: STATIC_HEADS.offline(),
		runAt: run.runAt,
		basis: lead ?? format.basis.join(' · '),
		format: { label: format.label, unit: format.unit },
		rows: rows.slice(0, OFFLINE_BOARD_ROWS).map((row) => ({
			id: row.id,
			rank: rankShown(row),
			name: row.name,
			position: row.position,
			positionRank: positionRankShown(row),
			team: row.team,
			projected: row.projected
		}))
	};
};
