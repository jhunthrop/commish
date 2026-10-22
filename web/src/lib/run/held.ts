/**
 * A HELD PAGE (Lane 136). The nightly's schema gate runs the build's reader over every page; a page the
 * reader refuses is held, and the run still publishes when few enough are (research/nightly/held_pages.py
 * holds the line). The run then carries `held.json`, and for each held page either an earlier run's copy
 * beside it (`held/<id>.json`, the page as that run published it, with its own stamp) or nothing, when
 * no earlier run has a page of his the reader takes: his page is then the board's figures alone.
 *
 * The reader never reads a held page's own document, and refuses every page a run does not hold, each
 * by name, so the gate can hold them and the build fails on any it was not told to hold.
 */
import { playerFormatSchema, type Board, type PlayerFormat } from './schema.ts';

/** The pages a read refused, each by its file and what was wrong: the run's own pages and the earlier
 * runs' copies of its held ones, apart. */
export class RefusedPages extends Error {
	readonly pages: ReadonlyMap<string, string>;
	readonly copies: ReadonlyMap<string, string>;

	constructor(pages: ReadonlyMap<string, string>, copies: ReadonlyMap<string, string>) {
		const named = [
			...[...pages].map(([id, refusal]) => `players/${id}.json: ${refusal}`),
			...[...copies].map(([id, refusal]) => `held/${id}.json: ${refusal}`)
		];
		super(`The reader refused ${String(named.length)} player files: ${named.join(' | ')}`);
		this.name = 'RefusedPages';
		this.pages = pages;
		this.copies = copies;
	}
}

/** His numbers in every format whose board ranks him, as a page's formats read: a held page with no
 * copy shows the board's figures and nothing of its own. */
export function boardFormats(
	boards: readonly { id: string; board: Board }[],
	id: string
): Record<string, PlayerFormat> {
	return Object.fromEntries(
		boards.flatMap(({ id: format, board }) => {
			const row = board.rows.find((candidate) => candidate.id === id);
			return row ? [[format, playerFormatSchema.parse(row)] as const] : [];
		})
	);
}
