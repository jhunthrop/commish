/**
 * Every artifact a build reads from a run (lib/server/run.ts): the manifest, a board for each format
 * it lists, the index, a page for each player the index gives one, the ADP, the record, the clubs and
 * the schedule. A run may leave out the designations and the held pages; a held page's copy is read
 * only for a page held.json names. The branch build's fixture run (shared/scripts/export-run.ts)
 * carries every file this names, and its test fails on one it lacks (Lane 252, B259).
 */
import { RUN_PATHS } from './schema.ts';

/** The artifacts a run may leave out: the build reads each when it is there. */
export const OPTIONAL_READS: readonly string[] = [RUN_PATHS.designations, RUN_PATHS.held];

/** The artifacts every build of a run reads, by path within the run, given the formats its manifest
 * lists and the players its index gives a page. */
export function buildReads(formats: readonly { id: string }[], pages: readonly string[]): string[] {
	return [
		RUN_PATHS.manifest,
		...formats.map((format) => RUN_PATHS.board(format.id)),
		RUN_PATHS.index,
		...pages.map((id) => RUN_PATHS.player(id)),
		RUN_PATHS.adp,
		RUN_PATHS.record,
		RUN_PATHS.clubs,
		RUN_PATHS.schedule
	];
}
