<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A plain list of things the account holds, each an ActionRow: what it is on the left, its one
	 * quiet verb on the right (Detach, Disconnect, Unpair). */
	interface Props {
		label: string;
		children: Snippet;
	}

	let { label, children }: Props = $props();
</script>

<ul class="rows" aria-label={label}>
	{@render children()}
</ul>

<style>
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
</style>
