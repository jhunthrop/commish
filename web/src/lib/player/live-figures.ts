/** The player page's rest-of-season figures on one clock (Lane 86, re-review N1): the run's until the
 * read answers, then the read's alone, a figure it lacks null (the page prints the empty figure), so no
 * box or column mixes the run's clock with the read's. Imports nothing: the page carries it. */
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { TierCliff } from '#lib/ui/tier.ts';
import type { LiveFormats, LiveTier } from './week-words.ts';

/** The tier box's players: each one's live figure once the read has answered. */
export function matesAt<M extends { id: string; projected: number }>(
	mates: readonly M[],
	live: LiveTier | null
): (Omit<M, 'projected'> & { projected: number | null })[] {
	if (live === null) return [...mates];
	return mates.map((mate) => ({ ...mate, projected: live.points[mate.id] ?? null }));
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
