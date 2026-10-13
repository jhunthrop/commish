<script lang="ts">
	import Label from './Label.svelte';

	interface Props {
		title: string;
		/** The label at the right end: what the panel's numbers are, "Drop to next", or a count. */
		aside?: string;
		/** The heading level the page's outline needs. */
		level?: 2 | 3;
	}

	let { title, aside, level = 3 }: Props = $props();
</script>

<svelte:element this={`h${String(level)}`} class="head">
	<span>{title}</span>
	{#if aside}<Label>{aside}</Label>{/if}
</svelte:element>

<style>
	.head {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
		font-weight: 700;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--s-3);
	}
</style>
