/** The boards the run carries, as the switch's menu offers them with no league (data/formats.json,
 * written at build from the run's manifest), the default first. When the file does not answer in
 * time, the three the api always accepts stand in. */
import { resolve } from '$app/paths';
import { FORMAT_LABELS } from '#lib/sheet/format.ts';
import type { BoardFormat } from './words.ts';

/** A board the run carries: the API's name and the chip's words. */
export interface RunBoard {
	format: BoardFormat;
	label: string;
}

/** How long the menu waits for the run's boards before it offers the stand-ins. */
const BOARDS_TIMEOUT_MS = 3_000;

/** The boards offered when the run's file does not answer: PPR, Half PPR and Standard. */
export const FALLBACK_BOARDS: readonly RunBoard[] = (['ppr', 'half_ppr', 'standard'] as const).map(
	(format) => ({ format, label: FORMAT_LABELS[format] })
);

export async function runBoards(): Promise<readonly RunBoard[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), BOARDS_TIMEOUT_MS);
	try {
		const response = await fetch(resolve('/data/formats.json'), { signal: controller.signal });
		if (!response.ok)
			throw new Error(`The run's boards did not load (${String(response.status)}).`);
		const boards: RunBoard[] = await response.json();
		return boards;
	} finally {
		clearTimeout(timer);
	}
}
