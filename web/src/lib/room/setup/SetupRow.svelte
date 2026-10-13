<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		/** A second line under the label: "rounds follow from it: 15". */
		note?: string;
		children: Snippet;
	}

	let { label, note, children }: Props = $props();
</script>

<div class="f">
	<span class="k"
		>{label}{#if note}<small>{note}</small>{/if}</span
	>
	<div class="v">{@render children()}</div>
</div>

<style>
	.f {
		display: grid;
		grid-template-columns: 150px minmax(0, 1fr);
		gap: var(--s-3) var(--s-4);
		align-items: center;
		padding: var(--s-3) 0;
		border-top: 1px solid var(--line);
	}

	.f:last-of-type {
		border-bottom: 1px solid var(--line);
	}

	.k {
		font-weight: 600;
	}

	small {
		display: block;
		font-weight: 400;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.v {
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
		align-items: center;
	}

	@media (max-width: 760px) {
		.f {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
