<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The three uppercase titles in the number face: a page's title, a panel's
	 * name ("Pool", "The wall"), and a section of a long page.
	 */
	type Size = 'page' | 'panel' | 'section';

	const TAGS = { page: 'h2', panel: 'h2', section: 'h3' } as const satisfies Record<Size, string>;

	interface Props {
		size?: Size;
		/** A tracked label after the title on the same line: what the section counts. */
		note?: string;
		children: Snippet;
	}

	let { size = 'section', note, children }: Props = $props();
</script>

<svelte:element this={TAGS[size]} class="title {size}">
	{@render children()}
	{#if note}<span>{note}</span>{/if}
</svelte:element>

<style>
	.title {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		line-height: 0.95;
		text-transform: uppercase;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--s-3);
	}

	.page {
		font-size: var(--t-display);
	}

	.panel {
		font-size: var(--t-head);
	}

	.section {
		font-size: var(--t-xl);
	}

	span {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: var(--t-xs);
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	@media (max-width: 760px) {
		.page {
			font-size: var(--t-head);
		}
	}
</style>
