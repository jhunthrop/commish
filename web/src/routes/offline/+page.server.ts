import { OFFLINE_BOARD_ROWS } from '#lib/site/offline.ts';
import { boardSeason } from '#lib/server/board-season.ts';
import { board, defaultFormat, stamp } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** The offline shell: the default board's top rows from the run this deploy was built from, under
 * the board's own basis line, so its points name what they are. The service worker keeps this one
 * page and shows it when the network is gone. */
export const prerender = true;

export const load: PageServerLoad = async () => {
	const [run, format] = await Promise.all([stamp(), defaultFormat()]);
	const { rows } = await board(format.id);
	const { lead } = await boardSeason(format, rows.slice(0, OFFLINE_BOARD_ROWS));
	return {
		runAt: run.runAt,
		basis: lead ?? format.basis.join(' · '),
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
