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
		/** A name the member owns (a league's): it wraps, balanced, and is cut only past two lines. */
		wrap?: boolean;
		children: Snippet;
	}

	let { size = 'section', note, wrap = false, children }: Props = $props();
</script>

<svelte:element this={TAGS[size]} class="title {size}" class:wrap>
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

	/* Two lines at most, never cut mid-word on the first: the switch's menu carries the whole name. */
	.wrap {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		text-wrap: balance;
		overflow-wrap: anywhere;
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
