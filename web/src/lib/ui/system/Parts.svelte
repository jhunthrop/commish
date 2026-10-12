<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A grid of tiles, as many across as fit at 220px. A list of Part, or a grid of whole panels. */
	interface Props {
		as?: 'ul' | 'div';
		children: Snippet;
	}

	let { as = 'ul', children }: Props = $props();
</script>

<svelte:element this={as} class="parts">{@render children()}</svelte:element>

<style>
	.parts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--s-3);
	}
</style>
