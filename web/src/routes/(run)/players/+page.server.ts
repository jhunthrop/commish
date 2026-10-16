import { withStatuses } from '#lib/run/board-status.ts';
import { positionsIn, rowsAt } from '#lib/run/derive.ts';
import { positionRankShown, rankShown } from '#lib/run/held-places.ts';
import { board, defaultFormat, designations } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** Every player with a page, by position, in our rank at the position. A player on a season-long list
 * follows the available players at his position, his ranks shown as the word (Lane 63). */
export const load: PageServerLoad = async () => {
	const format = await defaultFormat();
	const [{ rows }, capture] = await Promise.all([board(format.id), designations()]);
	return {
		format: { id: format.id, label: format.label },
		groups: positionsIn(rows).map((position) => ({
			position,
			players: withStatuses(rowsAt(rows, position), capture).map((row) => ({
				id: row.id,
				slug: row.slug,
				name: row.name,
				team: row.team,
				positionRank: positionRankShown(row),
				ourRank: rankShown(row)
			}))
		}))
	};
};
