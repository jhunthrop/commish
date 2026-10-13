<script lang="ts">
	import { oddsShort } from '#lib/format/draft.ts';
	import Label from './Label.svelte';

	interface Props {
		/** The chance, 0 to 1, or null when the room has none for him. */
		odds: number | null;
		/** What the chance is of, printed under it: "still there at 6.05". */
		label: string;
	}

	let { odds, label }: Props = $props();

	const percent = $derived(odds === null ? 0 : Math.round(odds * 100));
</script>

<span class="cell">
	<b>{odds === null ? '–' : oddsShort(odds)}</b>
	<span class="meter" aria-hidden="true"><i style:width="{percent}%"></i></span>
	<Label size="cell">{odds === null ? 'not in the odds' : label}</Label>
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

	@media (max-width: 760px) {
		.cell {
			padding: 0 var(--s-2);
		}

		b {
			font-size: 20px;
		}
	}
</style>
