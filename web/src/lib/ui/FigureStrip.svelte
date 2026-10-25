<script lang="ts">
	import type { StripCell } from '#lib/league/box/figure-strip.ts';
	import OppRank from './OppRank.svelte';

	/** A row's figures as labelled cells in one strip (Lane 209): each cell its head in small caps
	 * over its figure, never a sentence. Shown where a box score's figure columns give way; on a phone
	 * the cells line up row to row, one share of the strip each. */
	interface Props {
		cells: readonly StripCell[];
	}

	let { cells }: Props = $props();
</script>

<span class="strip" style:--strip-cells={cells.length}>
	{#each cells as cell (cell.head)}
		<span class="cell" class:key={cell.key === true} class:phone={cell.phoneOnly === true}
			><span class="head">{cell.head}</span>{#if cell.ease !== undefined}<OppRank
					text={cell.value}
					ease={cell.ease}
				/>{:else}<span class="v">{cell.value}</span>{/if}</span
		>
	{/each}
</span>

<style>
	/* Between a phone and a wide screen the strip sits under the name and wraps before it widens the
	   table. */
	.strip {
		display: flex;
		flex-wrap: wrap;
		gap: 2px var(--s-2);
	}

	.cell {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		min-width: 0;
	}

	.head {
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--ink-3);
	}

	.v,
	.cell :global(.rk),
	.cell :global(.none) {
		font-family: var(--font-num);
		font-size: var(--t-sm);
		font-weight: 600;
		line-height: 1.25;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--ink-2);
	}

	/* The opponent's tint as a slim mark, not the column's chip: the strip keeps one line of figures. */
	.cell :global(.rk) {
		min-width: 0;
		height: auto;
		padding: 0 3px;
	}

	.cell :global(.rk.easy),
	.cell :global(.rk.hard) {
		color: inherit;
	}

	.key .v {
		font-weight: 800;
		color: var(--ink);
	}

	.key .head {
		color: var(--ink-2);
	}

	.phone {
		display: none;
	}

	@media (max-width: 760px) {
		.strip {
			display: grid;
			grid-template-columns: repeat(var(--strip-cells), minmax(0, 1fr));
			gap: 4px;
		}

		.phone {
			display: flex;
		}
	}
</style>
