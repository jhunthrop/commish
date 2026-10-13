import { error, json } from '@sveltejs/kit';
import { toEntry } from '#lib/sheet/directory.ts';
import { parseFormat } from '#lib/sheet/format.ts';
import { SHEET_BOARD_FORMATS, sheetBoard } from '#lib/server/sheet-board.ts';
import type { EntryGenerator, RequestHandler } from './$types';

/** Our board as the sheet reads it, one static file per format, written at build. */
export const prerender = true;

export const entries: EntryGenerator = () => SHEET_BOARD_FORMATS.map((format) => ({ format }));

const NOT_FOUND = 404;

export const GET: RequestHandler = ({ params }) => {
	const format = parseFormat(params.format);
	const board = format === null ? null : sheetBoard(format);
	if (board === null) error(NOT_FOUND, 'We have no board for that format.');
	return json(board.map(toEntry));
};
