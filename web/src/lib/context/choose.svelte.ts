/** A choice in the shell's switch, made the site's context: at once in the store, then on the account
 * (PUT /me/league). Choices are numbered: only the latest one's answer counts, and only its refusal
 * puts the context back (to the account's own, read again). Apart from the store so a page carries
 * it only with the switch's menu or the league page, the two places a choice is made. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import { siteContext } from './context.svelte.ts';
import type { BoardFormat } from './words.ts';

type Account = components['schemas']['Account'];

/** One of the account's leagues, or a format with no league. */
export type Choice = { league: string } | { format: BoardFormat };

const NOT_FOUND = 404;

const client = apiClient(PUBLIC_API_URL);

/** Why the latest choice did not hold, in a sentence for the switch's menu; null when it did. */
export const switchProblem = $state<{ text: string | null }>({ text: null });

/** Makes the choice the context. Answers whether it held: false when the account refused it, or a
 * later choice took its place first. */
export async function choose(choice: Choice): Promise<boolean> {
	const seq = (siteContext.choices += 1);
	siteContext.open = false;
	switchProblem.text = null;
	const before = { league: siteContext.league, format: siteContext.format };
	if ('league' in choice) {
		const league = siteContext.leagues.find((candidate) => candidate.id === choice.league);
		if (!league) return false;
		siteContext.select(league, league.format);
	} else {
		siteContext.select(null, choice.format);
	}
	if (!siteContext.signedIn) return true;
	const body = 'league' in choice ? { league_id: choice.league } : { format: choice.format };
	try {
		const me = await client.call<Account>('/me/league', { method: 'PUT', body });
		if (seq !== siteContext.choices) return false;
		siteContext.take(me);
		return true;
	} catch (error) {
		if (seq !== siteContext.choices) return false;
		switchProblem.text =
			error instanceof ApiError && error.status === NOT_FOUND
				? 'That league is not on your account any more.'
				: 'Your league could not be switched just now. Try again in a moment.';
		// The context before the choice, then the account's own read again, is what the switch shows.
		siteContext.select(before.league, before.format);
		await siteContext.refresh();
		siteContext.open = true;
		return false;
	}
}
