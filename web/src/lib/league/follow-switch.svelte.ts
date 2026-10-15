/** A league's own page is the selected league: opening it selects it in the shell's switch, and a
 * later choice made in the switch opens the same page of the league switched to. Called once from a
 * league page's component setup. */
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { choose } from '#lib/context/choose.svelte.ts';
import { siteContext } from '#lib/context/context.svelte.ts';

export function followSwitch(id: string, pageFor: (league: string) => string): void {
	/** The switch's choices once this page made its league the context (when /me first answers),
	 * null before. Only a later choice made in the switch opens another league's page: a refused
	 * selection stays here, its sentence in the switch. */
	let adoptedAt = $state<number | null>(null);

	onMount(() => {
		void siteContext.load().then(async () => {
			if (siteContext.league?.id !== id && siteContext.leagues.some((l) => l.id === id)) {
				await choose({ league: id });
			}
			adoptedAt = siteContext.choices;
		});
	});

	$effect(() => {
		const selected = siteContext.league?.id ?? null;
		const switched = adoptedAt !== null && siteContext.choices !== adoptedAt;
		// pageFor is a route already resolved (links.league, the league tabs' hrefs).
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (switched && selected !== null && selected !== id) void goto(pageFor(selected));
	});
}
