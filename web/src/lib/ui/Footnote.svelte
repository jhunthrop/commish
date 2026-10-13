<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A quiet line at a page's foot: where its numbers came from, the method in one sentence. */
	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<p>{@render children()}</p>

<style>
	p {
		margin: 0;
		max-width: 68ch;
		color: var(--ink-3);
		font-size: var(--t-sm);
		line-height: 1.5;
	}
</style>
