/** How a page shows a kicker or a defense (Lane 66m): its face, and the basis said once over them. The
 * run's reader keeps them apart (run/market.ts); this module is the pages' side, so the contract the
 * nightly checks carries none of it. */
import { windowLabel } from '#lib/format/date.ts';
import type { AdpSource, Format } from '#lib/run/schema.ts';
import type { MarketPosition } from '#lib/types/player.ts';
import { clubMark } from '#lib/ui/club-mark.ts';

interface Faced {
	position: MarketPosition;
	team: string;
	headshot: string | null;
}

/** A kicker's or a defense's face: a defense's is its club's mark. */
export function marketFace(row: Faced): string | null {
	return row.position === 'DST' ? clubMark(row.team) : row.headshot;
}

/** His row with his face, worked out where the page is built, so no page's script carries the club
 * mark's address for it. */
export function withFace<R extends Faced>(row: R): R & { face: string | null } {
	return { ...row, face: marketFace(row) };
}

/** The basis the board says once over its kickers and defenses: "Kickers and defenses rank in draft
 * order from PPR drafts, Sep 9, with no projected points and no tiers." The drafts and their window
 * are the source the run names for the order; a run that names none says the order alone. */
export function marketBasis(
	format: Pick<Format, 'marketOrder'>,
	sources: readonly AdpSource[]
): string {
	const source = sources.find((candidate) => candidate.id === format.marketOrder);
	const from = source ? ` from ${source.drafts}, ${windowLabel(source.window)}` : '';
	return `Kickers and defenses the drafters take rank in their draft order${from}, with no projected points and no tiers.`;
}
