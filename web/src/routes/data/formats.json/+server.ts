import { manifest } from '#lib/server/run.ts';
import { apiFormatOf } from '#lib/run/format-ids.ts';
import type { RequestHandler } from './$types';

/** Every board the run carries, as the league switch offers them with no league: the API's name and
 * the chip's words, the default first. Written as a static file at build, fetched when the switch's
 * menu first opens. The run's manifest names them; the search index does not. */
export const prerender = true;

export const GET: RequestHandler = async () => {
	const { formats } = await manifest();
	return Response.json(
		formats.flatMap((format) => {
			const name = apiFormatOf(format);
			return name === null ? [] : [{ format: name, label: format.label }];
		})
	);
};
