import { record } from '#lib/server/run.ts';
import type { RequestHandler } from './$types';

/** Each graded week's players as the record counts a league's own starters from (Lane 93): written as
 * a static file at build and fetched by the record page only once a league is selected, so the page a
 * visitor loads carries none of them. The weekly record's weeks where the run carries it (Lane 114),
 * else the run's own; a run before Lane 93 carries no players: the file is empty. */
export const prerender = true;

export const GET: RequestHandler = async () => {
	const loaded = await record();
	const weeks = loaded.weekly?.weeks ?? loaded.weeks;
	return Response.json(
		Object.fromEntries(
			weeks.flatMap((week) => (week.players === undefined ? [] : [[week.week, week.players]]))
		)
	);
};
