<script lang="ts">
	import type { MockReport } from '../api.ts';
	import { ordinal } from '../words.ts';

	interface Props {
		runs: MockReport['runs'];
		teams: number;
		/** The draft's own rank, ringed in the rank counts. */
		rank: number;
	}

	let { runs, teams, rank }: Props = $props();

	/** The histogram's bars and the ranks printed under it. */
	const BINS = 12;
	const RANKS_SHOWN = 6;

	const bins = $derived.by(() => {
		const points = runs.points;
		const lo = points[0] ?? 0;
		const hi = points.at(-1) ?? 0;
		const width = (hi - lo) / BINS || 1;
		const counts = Array.from({ length: BINS }, () => 0);
		for (const x of points) {
			const bin = Math.min(BINS - 1, Math.floor((x - lo) / width));
			counts[bin] = (counts[bin] ?? 0) + 1;
		}
		const peak = Math.max(...counts, 1);
		const median = Math.min(BINS - 1, Math.floor((runs.median - lo) / width));
		return { counts, peak, median, lo, hi };
	});
	const round = (x: number) => Math.round(x).toLocaleString('en-US');
</script>

<div class="hist" aria-hidden="true">
	{#each bins.counts as count, i (i)}
		<i
			class:med={i === bins.median}
			style:height="{(count / bins.peak) * 100}%"
			title="{count} runs"
		></i>
	{/each}
</div>
<div class="x">
	<span>{round(bins.lo)}</span><span>median {round(runs.median)}</span><span>{round(bins.hi)}</span>
</div>
<div class="stats">
	<div class="stat"><b>{round(runs.median)}</b><span>median starting points</span></div>
	<div class="stat">
		<b>{round(runs.middle_low)} to {round(runs.middle_high)}</b><span>the middle 80% of runs</span>
	</div>
	<div class="stat">
		<b>{Math.round(runs.top_share * 100)}%</b><span
			>of runs finish top {runs.top_finish} of {teams}</span
		>
	</div>
</div>
<div class="ranks">
	{#each runs.rank_counts.slice(0, RANKS_SHOWN) as count, i (i)}
		<span class:you={i + 1 === rank}><b>{count}</b>{ordinal(i + 1)}</span>
	{/each}
</div>

<style>
	.hist {
		display: grid;
		grid-template-columns: repeat(12, 1fr);
		gap: 3px;
		align-items: end;
		height: 120px;
		margin-top: var(--s-2);
	}

	.hist i {
		display: block;
		background: var(--ink-3);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
	}

	.hist i.med {
		background: var(--accent);
	}

	.x {
		display: flex;
		justify-content: space-between;
		font-size: var(--t-xs);
		color: var(--ink-3);
		margin-top: 4px;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--s-3);
		margin-top: var(--s-3);
	}

	.stat {
		padding: var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}

	.stat b {
		display: block;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 34px;
		line-height: 0.9;
		font-variant-numeric: tabular-nums;
	}

	.stat span {
		display: block;
		margin-top: 6px;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.ranks {
		display: flex;
		gap: 4px;
		margin-top: var(--s-3);
	}

	.ranks span {
		flex: 1;
		text-align: center;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.ranks b {
		display: block;
		font-family: var(--font-num);
		font-weight: 700;
		font-size: 18px;
		color: var(--ink);
	}

	.ranks .you b {
		color: var(--accent-text);
	}

	@media (max-width: 760px) {
		.stats {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
