import { error } from '@sveltejs/kit';
import { parseFormat } from '#lib/sheet/format.ts';
import { runBoardFor, sheetBoardFormats } from '#lib/server/sheet-board.ts';
import type { EntryGenerator, RequestHandler } from './$types';

/** The run's board for a scoring format, one static file each, written at build: the league page
 * reads its players, ranks and values here and only the league's own numbers from the API. */
export const prerender = true;

export const entries: EntryGenerator = async () =>
	(await sheetBoardFormats()).map((format) => ({ format }));

const NOT_FOUND = 404;

export const GET: RequestHandler = async ({ params }) => {
	const format = parseFormat(params.format);
	const board = format === null ? null : await runBoardFor(format);
	if (board === null) error(NOT_FOUND, 'We have no board for that format.');
	return Response.json(board);
};
