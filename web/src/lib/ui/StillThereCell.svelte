<script lang="ts">
	import { chanceShort } from '#lib/format/draft.ts';
	import Label from './Label.svelte';

	interface Props {
		/** The chance, 0 to 1, or null when the room has none for him. */
		chance: number | null;
		/** What the chance is of, printed under it: "still there at 6.05". */
		label: string;
		/** What prints in place of a chance when there is none to show: "not read". */
		missing?: string;
	}

	let { chance, label, missing = 'not read' }: Props = $props();

	const percent = $derived(chance === null ? 0 : Math.round(chance * 100));
</script>

<span class="cell">
	{#if chance === null}
		<Label size="cell">{missing}</Label>
	{:else}
		<b>{chanceShort(chance)}</b>
		<span class="meter" aria-hidden="true"><i style:width="{percent}%"></i></span>
		<Label size="cell">{label}</Label>
	{/if}
</span>

<style>
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		text-align: right;
		height: calc(var(--row-h) - 8px);
		padding: 0 var(--s-3);
	}

	b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: var(--t-xl);
		line-height: 1;
	}

	.meter {
		height: 5px;
		border-radius: 3px;
		background: var(--surface-2);
		margin-top: 5px;
		overflow: hidden;
	}

	i {
		display: block;
		height: 100%;
		background: var(--ink-2);
	}

	/* On a phone the basis wraps under the number, so the cell grows with it. */
	@media (max-width: 760px) {
		.cell {
			padding: 0 var(--s-2);
			height: auto;
			min-height: calc(var(--row-h) - 8px);
		}

		b {
			font-size: 20px;
		}
	}
</style>
