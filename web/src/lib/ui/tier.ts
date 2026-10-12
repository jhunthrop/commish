/** Seven tier hues, hot to cold. A position with more tiers than hues wraps, and the printed
 * tier number keeps them apart. */
export const TIER_HUES = 7;

/** The custom property carrying a tier's hue, for a style:--tier binding. */
export function tierColor(tier: number): string {
	if (!Number.isInteger(tier) || tier < 1) {
		throw new RangeError(`A tier is a whole number from 1, got ${tier}.`);
	}
	return `var(--tier-${((tier - 1) % TIER_HUES) + 1})`;
}

/** The drop from one tier to the next, the reason tiers exist. */
export interface TierCliff {
	/** Projected points from the last player in this tier to the first in the next. */
	drop: number;
	nextTier: number;
}
