/** A league's own page and the shell's switch (B38): opening a league's page never changes the
 * selected league, which is the member's to change in the switch alone; a choice made in the switch
 * while on a league's page opens the same page of the league switched to. Called once from a league
 * page's component setup. */
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { siteContext } from '#lib/context/context.svelte.ts';

export function followSwitch(id: string, pageFor: (league: string) => string): void {
	/** The switch's choices when /me first answered on this page, null before. Only a later choice
	 * made in the switch opens another league's page. */
	let arrivedAt = $state<number | null>(null);

	onMount(() => {
		void siteContext.load().then(() => {
			arrivedAt = siteContext.choices;
		});
	});

	$effect(() => {
		const selected = siteContext.league?.id ?? null;
		const switched = arrivedAt !== null && siteContext.choices !== arrivedAt;
		// pageFor is a route already resolved (links.league, the league tabs' hrefs).
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (switched && selected !== null && selected !== id) void goto(pageFor(selected));
	});
}
