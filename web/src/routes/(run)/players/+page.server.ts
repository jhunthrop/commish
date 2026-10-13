import { positionsIn, rowsAt } from '#lib/run/derive.ts';
import { board, defaultFormat } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** Every player with a page, by position, in our rank at the position. */
export const load: PageServerLoad = async () => {
	const format = await defaultFormat();
	const { rows } = await board(format.id);
	return {
		format: { id: format.id, label: format.label },
		groups: positionsIn(rows).map((position) => ({
			position,
			players: rowsAt(rows, position).map(({ id, slug, name, team, positionRank, ourRank }) => ({
				id,
				slug,
				name,
				team,
				positionRank,
				ourRank
			}))
		}))
	};
};
