/** The nightly page parts on the system page, drawn from the run the build reads, so every
 * specimen is a real player: the first whose capsule carries pull figures, else the board's first. */
import type { BoardRow, IndexEntry } from '#lib/run/schema.ts';
import { board, defaultFormat, player } from '../run.ts';
import { playerPage, type PlayerPage } from './player.ts';

/** How many rows a list specimen shows. */
const SPECIMEN_ROWS = 4;

export interface SystemNightly {
	page: PlayerPage;
	rows: BoardRow[];
	hits: IndexEntry[];
}

async function specimenSlug(rows: readonly BoardRow[]): Promise<string> {
	for (const row of rows) {
		const loaded = await player(row.id);
		if (loaded.capsule && loaded.capsule.pulls.length > 0) return row.slug;
	}
	const [first] = rows;
	if (!first) throw new Error('The default board is empty.');
	return first.slug;
}

export async function systemNightly(): Promise<SystemNightly> {
	const { rows } = await board((await defaultFormat()).id);
	const page = await playerPage(await specimenSlug(rows));
	return {
		page,
		rows: rows.slice(0, SPECIMEN_ROWS),
		hits: rows.slice(0, SPECIMEN_ROWS).map(({ id, slug, name, team, position, headshot }) => ({
			id,
			slug,
			name,
			team,
			position,
			headshot
		}))
	};
}
