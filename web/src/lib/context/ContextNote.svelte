<script lang="ts">
	import { siteContext } from './context.svelte.ts';

	/** A page's one line about the selected league, under its head: what the figures are against the
	 * league's scoring (words.ts). Its room is kept from the first paint while a league is selected
	 * (the boot script's data-league), so filling it in moves nothing under it. With no league it
	 * takes no room. */
	interface Props {
		/** The line, from words.ts, for the context the page reads; null with no league. */
		note: string | null;
	}

	let { note }: Props = $props();

	const shown = $derived(siteContext.signedIn ? note : null);
</script>

<p class="note" class:filled={shown !== null}>{shown ?? ''}</p>

<style>
	.note {
		display: none;
		margin: 0;
		max-width: 90ch;
		font-size: var(--t-sm);
		line-height: 1.4;
		color: var(--ink-2);
	}

	.filled,
	:global(html[data-league]) .note {
		display: block;
		min-height: 1lh;
	}

	@media (max-width: 760px) {
		:global(html[data-league='2']) .note {
			min-height: 2lh;
		}
	}
</style>
