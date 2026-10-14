/** Every link between nightly pages, built once with resolve() so a route rename is one change. */
import { resolve } from '$app/paths';
import { positionSegment } from '#lib/run/derive.ts';
import type { Position } from '#lib/types/player.ts';
import {
	COMPANION_START,
	FOLLOWED_PARAM,
	LEAGUES_ANCHOR,
	LEAGUE_START,
	sectionHref
} from '#lib/ui/nav.ts';

/** The attach page's search parameter naming the way in it starts from: `?host=ffpc`. */
export const LEAGUE_HOST_PARAM = 'host';

/** The hosts whose leagues are followed from the member's own list, the attach page's other ways in. */
export const MEMBER_WAYS = ['ffpc', 'yahoo'] as const;
export type MemberWay = (typeof MEMBER_WAYS)[number];

export { FOLLOWED_PARAM, LEAGUES_ANCHOR };

/** The anchor of a player page's This season block. */
export const SEASON_ANCHOR = 'this-season';

export const links = {
	board: (format: string, position: Position | null = null): string =>
		position === null
			? resolve('/(run)/board/[format]', { format })
			: resolve('/(run)/board/[format]/[position]', {
					format,
					position: positionSegment(position)
				}),
	player: (slug: string): string => resolve('/(run)/players/[slug]', { slug }),
	/** His page at This season, the season line and the game log. */
	playerSeason: (slug: string): string =>
		`${resolve('/(run)/players/[slug]', { slug })}#${SEASON_ANCHOR}`,
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
	/** The account page at Your leagues, every league the account follows, saying how many were
	 * just followed when it is told. */
	accountLeagues: (followed?: number): string =>
		`${resolve('/account')}${followed === undefined ? '' : `?${new URLSearchParams({ [FOLLOWED_PARAM]: String(followed) }).toString()}`}#${LEAGUES_ANCHOR}`,
	/** The Draft Pass, the Membership and the Group Draft Pass. */
	pass: (): string => resolve('/pass'),
	/** Where a live draft starts being followed. */
	companionNew: (): string => resolve(COMPANION_START),
	companion: (id: string): string => resolve('/companion/[id]', { id }),
	claim: (code: string): string => resolve('/claim/[code]', { code }),
	/** Where a league on another host is attached, opened on a member host's way in when asked. */
	leagueNew: (host?: MemberWay): string =>
		host === undefined
			? resolve(LEAGUE_START)
			: `${resolve(LEAGUE_START)}?${new URLSearchParams({ [LEAGUE_HOST_PARAM]: host }).toString()}`,
	league: (id: string): string => resolve('/league/[id]', { id }),
	/** A new mock with a saved league's settings filled in, so drafting it is one tap. */
	mockLeague: (savedId: string): string =>
		`${sectionHref('mock')}?${new URLSearchParams({ league: savedId }).toString()}`,
	/** The prerendered JSON a browser fetches for one player's numbers. */
	playerData: (id: string): string => resolve('/data/players/[id].json', { id })
} as const;

/** The anchor of a tier strip, which the tier jump list links to. */
export function tierAnchor(position: Position, tier: number): string {
	return `${positionSegment(position)}-tier-${String(tier)}`;
}
