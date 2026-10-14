/** The boards the run carries, as the switch's menu offers them with no league (data/formats.json,
 * written at build from the run's manifest), the default first. */
import { resolve } from '$app/paths';
import type { BoardFormat } from './words.ts';

/** A board the run carries: the API's name and the chip's words. */
export interface RunBoard {
	format: BoardFormat;
	label: string;
}

export async function runBoards(): Promise<readonly RunBoard[]> {
	const response = await fetch(resolve('/data/formats.json'));
	if (!response.ok) throw new Error(`The run's boards did not load (${String(response.status)}).`);
	const boards: RunBoard[] = await response.json();
	return boards;
}
