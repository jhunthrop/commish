/** A board's rows beside the newest injury capture (Lane 63, the API's rule in
 * api/internal/solo/board_status.go): each listed player carries his status, and a player on a
 * season-long list (injured reserve, PUP, NFI, suspended, out for the season) moves to just after the
 * last available player at his position. His figures and his rank stay the run's, a figure that
 * assumes he plays; the row says so. A week's designation moves nothing. */
import type { Designations, PlayerStatus } from './schema.ts';
import type { Position } from '#lib/types/player.ts';

interface Placed {
	id: string;
	position: Position;
}

export type WithStatus<R> = R & { status?: PlayerStatus };

/** Whether a row's player is on a season-long list. */
export function heldOut(row: { status?: PlayerStatus }): boolean {
	return row.status?.seasonLong === true;
}

/** The rows with their statuses, each season-long one after the last available player at his
 * position (in their order), a position with nobody available as it was. No capture, no change. */
export function withStatuses<R extends Placed>(
	rows: readonly R[],
	designations: Designations | null
): WithStatus<R>[] {
	if (designations === null) return [...rows];
	const marked: WithStatus<R>[] = rows.map((row) => {
		const status = designations.players[row.id];
		return status === undefined ? row : { ...row, status };
	});
	const lastAvailable = new Map<Position, number>();
	const waiting = new Map<Position, WithStatus<R>[]>();
	marked.forEach((row, i) => {
		if (heldOut(row)) waiting.set(row.position, [...(waiting.get(row.position) ?? []), row]);
		else lastAvailable.set(row.position, i);
	});
	return marked.flatMap((row, i) => {
		const last = lastAvailable.get(row.position);
		const here = !heldOut(row) || last === undefined ? [row] : [];
		return i === last ? [...here, ...(waiting.get(row.position) ?? [])] : here;
	});
}
