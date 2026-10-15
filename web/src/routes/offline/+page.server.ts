import { OFFLINE_BOARD_ROWS } from '#lib/site/offline.ts';
import { board, defaultFormat, stamp } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** The offline shell: the default board's top rows from the run this deploy was built from. The
 * service worker keeps this one page and shows it when the network is gone. */
export const prerender = true;

export const load: PageServerLoad = async () => {
	const [run, format] = await Promise.all([stamp(), defaultFormat()]);
	const { rows } = await board(format.id);
	return {
		runAt: run.runAt,
		format: { label: format.label, unit: format.unit },
		rows: rows.slice(0, OFFLINE_BOARD_ROWS).map((row) => ({
			rank: row.ourRank,
			name: row.name,
			position: row.position,
			positionRank: row.positionRank,
			team: row.team,
			projected: row.projected
		}))
	};
};
