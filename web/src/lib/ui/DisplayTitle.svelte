<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The uppercase titles in the number face: a nightly page's head ("2026 Board"), a room's
	 * page title, a panel's name ("Pool", "The wall"), and a section of a long page.
	 */
	type Size = 'hero' | 'page' | 'panel' | 'section';

	const TAGS = {
		hero: 'h2',
		page: 'h2',
		panel: 'h2',
		section: 'h3'
	} as const satisfies Record<Size, string>;

	interface Props {
		size?: Size;
		/** A tracked label after the title on the same line: what the section counts. */
		note?: string;
		/** heading is the title's own heading. face draws the same title as a plain block, for a title
		 * that holds a control (a switch) whose page names its heading another way. */
		as?: 'heading' | 'face';
		children: Snippet;
	}

	let { size = 'section', note, as = 'heading', children }: Props = $props();
</script>

<svelte:element this={as === 'heading' ? TAGS[size] : 'div'} class="title {size}">
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

	.hero {
		font-size: var(--t-2xl);
		line-height: 0.9;
		letter-spacing: 0.01em;
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
		.hero {
			/* The mock's phone title, between --t-xl and --t-2xl. */
			font-size: calc((var(--t-xl) + var(--t-2xl)) / 2);
		}

		.page {
			font-size: var(--t-head);
		}
	}
</style>
