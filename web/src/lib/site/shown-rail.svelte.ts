/** The rail a prerendered page's words follow (season-words.ts): the build's while the page is drawn
 * and hydrated, so the HTML and its first frame agree, then the one the shell shows (the context's:
 * the selected league's phase, else the site's season as GET /season or /me corrects it). */
import { onMount } from 'svelte';
import { siteContext } from '#lib/context/context.svelte.ts';
import type { RailKey } from '#lib/ui/nav.ts';

/** Call while a component is set up: `built` is the site's rail at build, from the page's data. */
export function shownRail(built: () => RailKey): () => RailKey {
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	return () => (mounted ? siteContext.rail : built());
}
