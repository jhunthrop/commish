/** A choice in the shell's switch, made the site's context: at once in the store, then on the account
 * (PUT /me/league). Apart from the store so a page carries it only with the switch's menu or the
 * league page, the two places a choice is made. */
import { PUBLIC_API_URL } from '$app/env/public';
import { apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import { siteContext } from './context.svelte.ts';
import type { ContextFormat } from './words.ts';

type Account = components['schemas']['Account'];

/** One of the account's leagues, or a format with no league. */
export type Choice = { league: string } | { format: ContextFormat };

const client = apiClient(PUBLIC_API_URL);

/** Why the last choice did not hold, in a sentence for the switch's menu; null when it did. */
export const switchProblem = $state<{ text: string | null }>({ text: null });

/** Makes the choice the context. A choice the account refuses puts the last context back and says
 * so in the switch's menu. */
export async function choose(choice: Choice): Promise<void> {
	siteContext.open = false;
	switchProblem.text = null;
	const before = { league: siteContext.league, format: siteContext.format };
	if ('league' in choice) {
		const league = siteContext.leagues.find((candidate) => candidate.id === choice.league);
		if (!league) return;
		siteContext.select(league, league.format);
	} else {
		siteContext.select(null, choice.format);
	}
	if (!siteContext.signedIn) return;
	const body = 'league' in choice ? { league_id: choice.league } : { format: choice.format };
	try {
		siteContext.take(await client.call<Account>('/me/league', { method: 'PUT', body }));
	} catch {
		siteContext.select(before.league, before.format);
		switchProblem.text = 'Your league could not be switched just now. Try again in a moment.';
	}
}
