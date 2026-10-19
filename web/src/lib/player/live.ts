/** The player card's week (Lane 66h), read after the first paint and loaded only then: his Lineup
 * row from the API, in the league's scoring with a league followed (and the one verb its screens give
 * him), else in PPR. week-words.ts words it. */
import { PUBLIC_API_URL } from '$app/env/public';
import { resolve } from '$app/paths';
import { apiClient } from '#lib/api/client.ts';
import type { BoardFormat } from '#lib/sheet/model.ts';
import type { CardLeague, CardPlayer, PlayerWeek, ScreenHref } from './week-words.ts';

export { liveCard } from './week-words.ts';

const client = apiClient(PUBLIC_API_URL);

/** His week from the API: the league's read with a league, the public read without one or when the
 * league's cannot answer for him (out of season, a team the read lacks). */
export async function readWeek(
	player: CardPlayer,
	league: CardLeague | null,
	tier: TierQuery | null = null
): Promise<PlayerWeek> {
	const query = tierQueryOf(tier);
	if (league !== null) {
		try {
			return await client.call<PlayerWeek>(
				`/leagues/attached/${encodeURIComponent(league.id)}/players/${encodeURIComponent(player.id)}${query}`
			);
		} catch (error: unknown) {
			// eslint-disable-next-line no-console -- no user-facing text: the public read stands in
			console.warn('player card: the league read', error);
		}
	}
	return client.call<PlayerWeek>(`/players/${encodeURIComponent(player.id)}/week${query}`);
}

/** The tier box the read is asked for (Lane 86): its players in order, the next tier's first and its
 * format. */
export interface TierQuery {
	ids: readonly string[];
	next: string | null;
	format: BoardFormat;
}

function tierQueryOf(tier: TierQuery | null): string {
	if (tier === null || tier.ids.length === 0) return '';
	const params = new URLSearchParams({ tier: tier.ids.join(','), tier_format: tier.format });
	if (tier.next !== null) params.set('tier_next', tier.next);
	return `?${params.toString()}`;
}

/** A league screen's address with him named: the screen takes him from ?player=. */
export function screenHrefFor(league: CardLeague | null): ScreenHref {
	return (screen, query) => {
		if (league === null) throw new Error('A league screen needs a league.');
		const base = resolve('/league/[id]/[screen]', { id: league.id, screen });
		return `${base}?${new URLSearchParams(query).toString()}`;
	};
}
