<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** One line under the title naming what the specimens are drawn from. */
		sub?: string;
		children: Snippet;
	}

	let { title, sub, children }: Props = $props();
</script>

<section>
	<h3>{title}</h3>
	{#if sub}<p>{sub}</p>{/if}
	<div class="body">{@render children()}</div>
</section>

<style>
	section {
		min-width: 0;
	}

	h3 {
		margin: 0 0 var(--s-2);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 34px;
		line-height: 1;
		text-transform: uppercase;
	}

	p {
		margin: 0 0 var(--s-4);
		color: var(--ink-2);
		font-size: var(--t-sm);
		max-width: 72ch;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	@media (max-width: 760px) {
		h3 {
			font-size: 28px;
		}
	}
</style>
