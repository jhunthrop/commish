<script lang="ts">
	import type { FigureRow } from './figures.ts';

	/** One of the member's record rows as a row of cells (Lane 292's start and sit, Lane 298's points
	 * against the median): the row's head, each cell's label and figure, a figure rose where it says
	 * the member left points behind and green where they came out ahead; the API's sentence under it. */
	interface Props {
		row: FigureRow;
	}

	let { row }: Props = $props();
</script>

<section class="record" aria-label={row.head}>
	<div class="cells" data-figure={row.figure}>
		<span class="hd">{row.head}</span>
		{#each row.cells as cell (cell.label)}
			<span class="cell"
				><span class="lb">{cell.label}</span><b class={cell.tone}>{cell.value}</b></span
			>
		{/each}
	</div>
	<p class="basis" data-basis={row.figure}>{row.basis}</p>
</section>

<style>
	.cells {
		display: flex;
		align-items: baseline;
		gap: var(--s-4);
		padding: var(--s-2) var(--s-3);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		font-variant-numeric: tabular-nums;
	}

	.hd {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-lg);
		text-transform: uppercase;
		letter-spacing: 0.02em;
		margin-right: auto;
	}

	.cell {
		display: inline-flex;
		align-items: baseline;
		gap: var(--s-2);
	}

	.lb {
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	b {
		font-family: var(--font-num);
		font-size: var(--t-lg);
	}

	b.short {
		color: var(--loss-ink);
	}

	b.over {
		color: var(--gain-ink);
	}

	.basis {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
		line-height: 1.5;
	}

	@media (max-width: 760px) {
		.cells {
			gap: var(--s-3);
		}

		.basis {
			font-size: var(--t-xs);
			line-height: 1.45;
		}
	}
</style>
