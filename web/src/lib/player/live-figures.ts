/** The player page's rest-of-season figures on one clock (Lane 86, re-review N1): the run's until the
 * read answers, then the read's alone, a figure it lacks null (the page prints the empty figure), so no
 * box or column mixes the run's clock with the read's. Imports nothing: the page carries it. */
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import type { LiveFormats, LiveTier } from './week-words.ts';

/** A tier box player as the box draws him: his figure, his rank (null for none) and his weeks where they
 * are not the page's player's. */
interface DrawnMate {
	id: string;
	projected: number | null;
	positionRank: number | null;
	span: string | null;
}

/** Ranked players in their order, an unranked one after them. */
function byRank(a: number | null, b: number | null): number {
	if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
	return a - b;
}

/** The tier box's players: each one's live figure once the read has answered, and with an answer that
 * ranks them his rank and his weeks as the read says them, in the order of those ranks (Lane 162, D02
 * and D03: the box sorts by the number its head reads, a player unranked last). */
export function matesAt<M extends DrawnMate>(
	mates: readonly M[],
	live: LiveTier | null
): (Omit<M, keyof DrawnMate> & DrawnMate)[] {
	if (live === null) return [...mates];
	const drawn = mates.map((mate) => ({
		...mate,
		projected: live.points[mate.id] ?? null,
		positionRank: live.ranks === null ? mate.positionRank : (live.ranks[mate.id] ?? null),
		span: live.spans === null ? mate.span : (live.spans[mate.id] ?? null)
	}));
	if (live.ranks === null) return drawn;
	return drawn.toSorted((a, b) => byRank(a.positionRank, b.positionRank));
}

/** The tier's drop to the next: the live one once the read has answered. */
export function cliffAt(
	cliff: TierCliff | null,
	live: LiveTier | null
): (Omit<TierCliff, 'drop'> & { drop: number | null }) | null {
	if (cliff === null || live === null) return cliff;
	return { ...cliff, drop: live.drop };
}

/** One every-format line's points and Over repl.: the read's once it has answered. */
export function lineFiguresAt(
	run: { points: number; vor: number | null },
	format: BoardFormat | null,
	live: LiveFormats | null
): { points: number | null; vor: number | null } {
	if (live === null) return run;
	const read = format === null ? undefined : live.figures[format];
	return read ?? { points: null, vor: null };
}

/** One every-format line's place at his position on the table's one clock (Lane 220, B184): the run's
 * until the read answers, then the read's in the format the read is in, the head's own rank, and none
 * in another format, which the read does not place. */
export function lineRankAt(
	run: number,
	format: BoardFormat | null,
	read: { format: BoardFormat | null; positionRank: number | null } | null
): number | null {
	if (read === null) return run;
	return format !== null && format === read.format ? read.positionRank : null;
}
