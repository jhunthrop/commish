<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A screen's one verb, in its place at a desk and pinned above the tab bar in a hand (the League
	 * page and the front door, Lane 66k M4): clear of the home indicator by the safe area, full width,
	 * on the page's raised shadow. One rule, so both pins sit alike. */
	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="pinned" data-pin>{@render children()}</div>

<style>
	@media (max-width: 760px) {
		.pinned {
			position: fixed;
			left: var(--s-3);
			right: var(--s-3);
			bottom: calc(var(--tab-bar-h) + env(safe-area-inset-bottom, 0px) + var(--s-2));
			z-index: 10;
			display: grid;
			margin: 0;
			box-shadow: var(--shadow-pop);
			border-radius: var(--r-md);
		}

		.pinned :global(a) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
