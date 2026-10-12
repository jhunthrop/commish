<script lang="ts">
	import Label from './Label.svelte';

	/** The column heads over a run of Rows, on the same grid. Hidden on the phone, where each cell names itself. */
</script>

<div class="head" aria-hidden="true">
	<span></span>
	<span></span>
	<Label>Player</Label>
	<span class="proj"><Label align="end">Projected</Label></span>
	<span class="end"><Label align="end">Over replacement</Label></span>
	<span class="rng"><Label>Floor to ceiling</Label></span>
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
