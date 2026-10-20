<script lang="ts">
	import { BOX, boxNumber, type BoxTotals } from './box.ts';

	/** The Team row's two figure cells, one rule for the Matchup's boxes, the Lineup and the League
	 * page's lineup (Lane 92, B22): before the first kickoff the Proj is the big figure and the Pts
	 * small; from it the Pts are big, with the projected final small under the Proj column, captioned
	 * once. Drawn on the lit board the table's Team row is. */
	interface Props {
		totals: BoxTotals;
		/** The big figure's size: the Lineup's own table draws it larger. */
		size?: 'md' | 'lg';
	}

	let { totals, size = 'md' }: Props = $props();
	const live = $derived(totals.live);
</script>

<td class="n proj {size}" class:live
	>{#if live}<small>{BOX.projFinal}</small>{/if}{boxNumber(live ? totals.final : totals.proj)}</td
>
<td class="n pts {size}" class:live>{boxNumber(totals.pts)}</td>

<style>
	/* The Team row's own board, as its other cells draw it (BoxTable, LineupTable). */
	td {
		padding: 0 var(--s-2);
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
	}

	.n {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* The big figure: the Proj before kickoff, the Pts from it. */
	.proj,
	.pts.live {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--scoreboard-num);
	}

	.lg.proj,
	.lg.pts.live {
		font-size: var(--t-2xl);
		font-weight: 800;
	}

	/* The small figure: the Pts before kickoff, the projected final from it. */
	.pts,
	.proj.live {
		font-size: var(--t-xl);
		font-weight: 700;
		color: var(--scoreboard-ink-2);
	}

	.proj.live {
		font-size: var(--t-lg);
	}

	small {
		display: block;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		font-weight: 600;
		line-height: 1.1;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--scoreboard-ink-2);
	}

	@media (max-width: 760px) {
		.proj,
		.pts,
		.lg.proj,
		.lg.pts.live {
			font-size: var(--t-lg);
		}

		.proj.live {
			font-size: var(--t-md);
		}

		/* The caption takes two lines in the narrow column, so it never runs across the divider into
		   the Pts (fix round 1). */
		small {
			white-space: normal;
			letter-spacing: 0.02em;
		}

		/* The board's own divider between the Team row's two figures, so 101.6 and -- read as two
		   columns (Lane 83). */
		.pts {
			padding-left: var(--s-2);
			border-left: 1px solid var(--scoreboard-line);
		}
	}
</style>
