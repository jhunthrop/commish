<script lang="ts">
	import { FIGURE_WORDS, type StartSitRow } from './figures.ts';

	/** The member's start and sit record (Lane 292) as one row of cells: the weeks their set lineup
	 * matched our picks, and what our picks scored less theirs, rose when ours would have added points
	 * and green when theirs scored more; the API's sentence under it. */
	interface Props {
		row: StartSitRow;
	}

	let { row }: Props = $props();
</script>

<section class="record" aria-label={FIGURE_WORDS.startSit}>
	<div class="cells" data-figure="start-sit">
		<span class="hd">{FIGURE_WORDS.startSit}</span>
		<span class="cell"><span class="lb">{FIGURE_WORDS.matched}</span><b>{row.matched}</b></span>
		<span class="cell"
			><span class="lb">{FIGURE_WORDS.ours}</span><b class={row.tone}>{row.ours}</b></span
		>
	</div>
	<p class="basis" data-basis="start-sit">{row.basis}</p>
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

	b.ahead {
		color: var(--loss-ink);
	}

	b.behind {
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
