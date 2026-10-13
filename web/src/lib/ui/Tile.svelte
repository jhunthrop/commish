<script lang="ts">
	import type { Snippet } from 'svelte';
	import Label from './Label.svelte';

	interface Props {
		/** The tile's name, a link to its page: "Arizona Cardinals". */
		title: string;
		href: string;
		/** One uppercase line under the name: "ARI · bye week 14". */
		meta?: string;
		/** The tile's number with its basis, then anything else it lists. */
		children: Snippet;
	}

	let { title, href, meta, children }: Props = $props();
</script>

<div class="tile">
	<div class="top">
		<a class="name" {href}>{title}</a>
		{#if meta}<Label>{meta}</Label>{/if}
	</div>
	{@render children()}
</div>

<style>
	.tile {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-3) var(--s-4);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		min-width: 0;
	}

	.top {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.name {
		font-weight: 700;
		font-size: var(--t-lg);
		text-decoration: none;
	}

	.name:hover {
		text-decoration: underline;
	}
</style>
