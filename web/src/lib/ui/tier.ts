/** Seven steps of the one ink ramp (tokens.css, B47), tier 1 the full ink. The ramp never wraps: a
 * position's tiers past the last step share its lightest ink (fix round 1, HIGH-2), and the printed
 * tier number keeps them apart. */
export const TIER_HUES = 7;

/** A tier's step on the ramp, 1 to TIER_HUES, the last for every tier past it. */
function tierStep(tier: number): number {
	if (!Number.isInteger(tier) || tier < 1) {
		throw new RangeError(`A tier is a whole number from 1, got ${tier}.`);
	}
	return Math.min(tier, TIER_HUES);
}

/** The custom property carrying a tier's shade, for a style:--tier binding. */
export function tierColor(tier: number): string {
	return `var(--tier-${String(tierStep(tier))})`;
}

/** The text on a tier's shade, for a style:--tier-ink binding: the page's colour on the dark steps,
 * the ink on the light ones (B47). */
export function tierInk(tier: number): string {
	return `var(--tier-ink-${String(tierStep(tier))})`;
}

/** What a tier's players are called, one and many: { one: 'WR', many: 'WRs' }. */
export interface GroupName {
	one: string;
	many: string;
}

/** The drop from one tier to the next, the reason tiers exist. */
export interface TierCliff {
	/** Projected points from the last player in this tier to the first in the next. */
	drop: number;
	nextTier: number;
	/** The next tier's first player, the end of the drop (the player read's tier_next, Lane 86); absent
	 * where no board row stands behind it (a mock). */
	nextId?: string;
}
