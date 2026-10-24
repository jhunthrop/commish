import { withStatuses } from '#lib/run/board-status.ts';
import { positionsIn, rowsAt } from '#lib/run/derive.ts';
import { heldWord, positionRankShown, rankShown } from '#lib/run/held-places.ts';
import { rankingsHead } from '#lib/server/pages/head.ts';
import { board, defaultFormat, designations } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** Every player with a page, by position, in our rank at the position. A player on a season-long list
 * follows the available players at his position, his ranks shown as the word (Lane 63). The head
 * lists the top of our order among the available players (Lane 169). */
export const load: PageServerLoad = async ({ parent }) => {
	const format = await defaultFormat();
	const [{ rows }, capture, { run }] = await Promise.all([
		board(format.id),
		designations(),
		parent()
	]);
	const groups = positionsIn(rows).map((position) => ({
		position,
		rows: withStatuses(rowsAt(rows, position), capture)
	}));
	const ordered = groups
		.flatMap((group) => group.rows)
		.filter((row) => heldWord(row) === null)
		.sort((a, b) => a.ourRank - b.ourRank);
	return {
		format: { id: format.id, label: format.label },
		groups: groups.map((group) => ({
			position: group.position,
			players: group.rows.map((row) => ({
				id: row.id,
				slug: row.slug,
				name: row.name,
				team: row.team,
				positionRank: positionRankShown(row),
				ourRank: rankShown(row)
			}))
		})),
		head: rankingsHead(format, run.season, run.week, ordered)
	};
};
