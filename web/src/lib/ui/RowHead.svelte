<script lang="ts">
	import Label from './Label.svelte';

	/** The column heads over a run of Rows, on the same grid. Hidden on the phone, where each cell names itself. */
	interface Props {
		/** The floor to ceiling column, on unless the view switches it off. Rows under it take the same. */
		range?: boolean;
	}

	let { range = true }: Props = $props();
</script>

<div class="head" class:flat={!range} aria-hidden="true">
	<span></span>
	<span></span>
	<Label>Player</Label>
	<span class="proj"><Label align="end">Projected</Label></span>
	<span class="end"><Label align="end">Over replacement</Label></span>
	{#if range}<span class="rng"><Label>Floor to ceiling</Label></span>{/if}
	<Label>Drafters vs us</Label>
</div>

<style>
	.head {
		display: grid;
		grid-template-columns: var(--board-cols);
		align-items: center;
		column-gap: var(--s-3);
		padding: 0 var(--s-3) var(--s-2);
		border-bottom: 1px solid var(--line);
	}

	.flat {
		grid-template-columns: var(--board-cols-flat);
	}

	.proj,
	.end {
		text-align: right;
	}

	@media (max-width: 960px) {
		.rng {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.head {
			display: none;
		}
	}
</style>
