/** Every link between nightly pages, built once with resolve() so a route rename is one change. */
import { resolve } from '$app/paths';
import { positionSegment } from '#lib/run/derive.ts';
import type { Position } from '#lib/types/player.ts';

export const links = {
	board: (format: string, position: Position | null = null): string =>
		position === null
			? resolve('/(run)/board/[format]', { format })
			: resolve('/(run)/board/[format]/[position]', {
					format,
					position: positionSegment(position)
				}),
	player: (slug: string): string => resolve('/(run)/players/[slug]', { slug }),
	adp: (format: string): string => resolve('/(run)/adp/[format]', { format }),
	record: (): string => resolve('/(run)/record'),
	clubs: (): string => resolve('/(run)/clubs'),
	club: (abbr: string): string => resolve('/(run)/clubs/[abbr]', { abbr: abbr.toLowerCase() }),
	schedule: (): string => resolve('/(run)/schedule'),
	compare: (a?: string, b?: string): string => {
		const query = new URLSearchParams();
		if (a) query.set('a', a);
		if (b) query.set('b', b);
		const search = query.toString();
		return `${resolve('/(run)/compare')}${search === '' ? '' : `?${search}`}`;
	},
	/** Your cheat sheet. Every page outside the sheet links it through here. */
	sheet: (): string => resolve('/sheet'),
	account: (): string => resolve('/account'),
	/** The Draft Pass, the Membership and the Group Draft Pass. */
	pass: (): string => resolve('/pass'),
	/** Where a live draft starts being followed. */
	companionNew: (): string => resolve('/companion/new'),
	companion: (id: string): string => resolve('/companion/[id]', { id }),
	claim: (code: string): string => resolve('/claim/[code]', { code }),
	/** The prerendered JSON a browser fetches for one player's numbers. */
	playerData: (id: string): string => resolve('/data/players/[id].json', { id })
} as const;

/** The anchor of a tier strip, which the tier jump list links to. */
export function tierAnchor(position: Position, tier: number): string {
	return `${positionSegment(position)}-tier-${String(tier)}`;
}
