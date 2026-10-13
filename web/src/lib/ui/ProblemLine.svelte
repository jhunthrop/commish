<script lang="ts">
	import type { Snippet } from 'svelte';

	/** What went wrong with a verb, said where the verb is, in the loss ink, announced at once. */
	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<p role="alert">{@render children()}</p>

<style>
	p {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}
</style>
