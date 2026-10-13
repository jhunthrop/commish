<script lang="ts">
	import type { Snippet } from 'svelte';

	/** One named part: the primitive itself, its name, and one line on what it carries. */
	interface Props {
		name: string;
		about?: string;
		/** The primitive, rendered live. Omitted for a rule with nothing to show. */
		show?: Snippet;
	}

	let { name, about, show }: Props = $props();
</script>

<li>
	{#if show}<span class="show">{@render show()}</span>{/if}
	<b>{name}</b>
	{#if about}<p>{about}</p>{/if}
</li>

<style>
	li {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
		padding: var(--s-4);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		min-width: 0;
	}

	.show {
		min-height: 48px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}

	b {
		font-size: var(--t-md);
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>
