import type { RangeScale } from '#lib/types/player.ts';

/** Where a point falls on a range bar, as a percent of its width, clamped to the bar: the one rule
 * RangeBar draws by, and the apps' bars are held to. */
export function rangePercent(points: number, scale: RangeScale): number {
	const span = scale.hi - scale.lo;
	if (span <= 0)
		throw new RangeError(`A range scale needs hi above lo, got ${scale.lo} to ${scale.hi}.`);
	return Math.min(100, Math.max(0, ((points - scale.lo) / span) * 100));
}

/** The scale the bars in one list share, so spans compare across rows: the lowest floor to the
 * highest ceiling, null with no range. */
export function sharedScale(
	ranges: readonly { floor: number; ceiling: number }[]
): RangeScale | null {
	const all = ranges.flatMap((r) => [r.floor, r.ceiling]);
	return all.length === 0 ? null : { lo: Math.min(...all), hi: Math.max(...all) };
}
